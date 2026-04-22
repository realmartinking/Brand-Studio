import pdfParse from "pdf-parse";
import { load } from "cheerio";
import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { generateWithClaude } from "../ai/gateway";
import { appendDialogMessage } from "../db/briefs";
import { logger } from "../config/logger";


const log = logger.child({ mod: "urlFetch" });
const FETCH_TIMEOUT_MS = 30_000;

// ── URL type detection & resolution ──────────────────────────────────────────

function isPdfUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes(".pdf") ||
    lower.includes("drive.google.com") ||
    lower.includes("disk.yandex") ||
    lower.includes("yadi.sk") ||
    (lower.includes("dropbox.com") && lower.includes("dl=1"))
  );
}

/**
 * Resolves cloud-storage share links to direct download URLs.
 * Returns { directUrl, forcePdf } or null if not a special URL / resolution failed.
 */
async function resolveSpecialUrl(
  url: string
): Promise<{ directUrl: string; forcePdf: boolean } | null> {
  // ── Yandex.Disk ──────────────────────────────────────────────────────────
  if (url.includes("disk.yandex") || url.includes("yadi.sk")) {
    try {
      const apiUrl =
        `https://cloud-api.yandex.net/v1/disk/public/resources/download` +
        `?public_key=${encodeURIComponent(url)}`;
      const apiRes = await fetchWithTimeout(apiUrl);
      if (!apiRes.ok) return null;
      const data = (await apiRes.json()) as { href?: string };
      if (data.href) {
        return {
          directUrl: data.href,
          forcePdf: data.href.toLowerCase().includes(".pdf"),
        };
      }
    } catch {
      // fall through to normal fetch
    }
    return null;
  }

  // ── Google Drive ─────────────────────────────────────────────────────────
  if (url.includes("drive.google.com")) {
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) {
      return {
        directUrl: `https://drive.google.com/uc?export=download&id=${match[1]}`,
        forcePdf: true,
      };
    }
  }

  return null;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 40);
  }
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

class FetchError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "FetchError";
  }
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function assertOk(res: Response): void {
  if (res.status === 401 || res.status === 403) {
    throw new FetchError("access_denied", res.status);
  }
  if (!res.ok) {
    throw new FetchError(`HTTP ${res.status}`, res.status);
  }
}

// ── Content extractors ────────────────────────────────────────────────────────

async function extractPdfText(url: string): Promise<string> {
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; BrandStudioBot/1.0)" },
  });
  assertOk(res);
  const buf = Buffer.from(await res.arrayBuffer());
  const data = await pdfParse(buf);
  return data.text.trim();
}

async function extractWebText(url: string): Promise<string> {
  const res = await fetchWithTimeout(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "ru,en;q=0.9",
    },
  });
  assertOk(res);
  const html = await res.text();
  const $ = load(html);
  $(
    "script, style, nav, header, footer, aside, iframe, noscript, " +
    "[role='navigation'], [role='banner'], [role='complementary']"
  ).remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return text.slice(0, 10_000);
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleUrlMessage(ctx: BotContext, url: string): Promise<void> {
  const projectId = ctx.session.active_project_id;
  const awaiting = ctx.session.awaiting_input;
  const hostname = hostnameOf(url);

  await ctx.reply("🔗 Читаю ссылку...");
  await ctx.api.sendChatAction(ctx.chat!.id, "typing");

  // ── Extract text ──────────────────────────────────────────────────────────

  let text: string;
  try {
    const resolved = await resolveSpecialUrl(url);
    const effectiveUrl = resolved?.directUrl ?? url;
    const usePdf = resolved?.forcePdf ?? isPdfUrl(url);
    text = usePdf ? await extractPdfText(effectiveUrl) : await extractWebText(effectiveUrl);
  } catch (err) {
    const e = err as Error & { status?: number };
    if (e.name === "AbortError") {
      await ctx.reply("Не удалось загрузить страницу — она слишком долго отвечает.");
      return;
    }
    if (e.message === "access_denied" || e.status === 401 || e.status === 403) {
      await ctx.reply("Нет доступа к странице. Проверьте что ссылка открыта для всех.");
      return;
    }
    log.error({ err: (err as Error).message }, "error:");
    await ctx.reply(`❌ Не удалось загрузить страницу: ${e.message}`);
    return;
  }

  if (!text || text.trim().length === 0) {
    await ctx.reply(
      "Не удалось извлечь текст со страницы. Попробуйте скопировать текст вручную."
    );
    return;
  }

  const docName = `URL: ${hostname}`;

  // ── Route by context ──────────────────────────────────────────────────────

  // Case 1: In briefing → auto-inject as dialog context
  if (awaiting === "briefing" && projectId) {
    await appendDialogMessage(projectId, {
      role: "user",
      content: `[Ссылка «${url}»]\n\n${text}`,
    });
    await ctx.reply("✅ Изучил ссылку, добавил информацию в контекст проекта.");
    return;
  }

  // Case 2: Active project → ask whether to use
  if (projectId) {
    ctx.session.pending_doc_analysis = text;
    ctx.session.pending_doc_filename = docName;

    const kb = new InlineKeyboard()
      .text("✅ Да, использовать", "doc:use")
      .text("❌ Нет", "doc:skip");

    await ctx.reply(
      `Прочитал страницу *${hostname}* (${text.length} симв.). Хотите использовать эту информацию в проекте?`,
      { parse_mode: "Markdown", reply_markup: kb }
    );
    return;
  }

  // Case 3: No active project → generate brief summary
  await ctx.reply("💭 Думаю...");
  let summary: string;
  try {
    summary = (
      await generateWithClaude(
        "Кратко изложи суть текста в 2-3 предложениях на русском языке.",
        text,
        { maxTokens: 200, tier: "classifier", softFail: true }
      )
    ).trim();
    if (!summary) summary = text.slice(0, 500);
  } catch {
    summary = text.slice(0, 500);
  }

  const kb = new InlineKeyboard()
    .text("🚀 Новый проект", "new_project")
    .text("📂 Мои проекты", "my_projects");

  await ctx.reply(`Прочитал страницу *${hostname}*.\n\n${summary}`, {
    parse_mode: "Markdown",
    reply_markup: kb,
  });
}
