import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import {
  extractFileKeyFromUrl,
  getFilePages,
  getPageTextContent,
} from "../integrations/figma";
import { saveFigmaReference, getFigmaReferences, deleteFigmaReferences } from "../db/figmaRefs";
import { updateStyleGuide } from "../db/projects";
import { appendUploadedDocument } from "../db/briefs";
import { generateWithClaude } from "../ai/gateway";
import { getUserRole, isPrivileged } from "../db/queries";

const CHUNK_SIZE = 4000;
const CHUNK_DELAY_MS = 300;

const STYLE_GUIDE_PROMPT = `Проанализируй эти тексты из реальных брендинговых проектов. Извлеки из них: стиль формулировок, принципы мышления, структуру подачи, характерные приёмы, запрещённые паттерны. Сформулируй Style Guide студии.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Splits text into chunks ≤ maxLen characters, breaking on double newlines
 * (paragraph boundaries). Falls back to hard split if a single paragraph
 * exceeds maxLen.
 */
function splitIntoChunks(text: string, maxLen = CHUNK_SIZE): string[] {
  if (text.length <= maxLen) return [text];

  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length <= maxLen) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      if (para.length > maxLen) {
        // Hard-split oversized single paragraph
        for (let i = 0; i < para.length; i += maxLen) {
          chunks.push(para.slice(i, i + maxLen));
        }
        current = "";
      } else {
        current = para;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function afterExtractionKeyboard() {
  return new InlineKeyboard()
    .text("📎 Загрузить ещё проект", "figma:load_more")
    .row()
    .text("✅ Готово, создать Style Guide", "figma:style_guide");
}

function withProjectKeyboard() {
  return new InlineKeyboard()
    .text("📋 Добавить в бриф проекта", "figma:use_as_brief")
    .row()
    .text("🎨 Создать Style Guide", "figma:style_guide")
    .row()
    .text("📎 Сохранить как референс", "figma:save_ref");
}

function withoutProjectKeyboard() {
  return new InlineKeyboard()
    .text("🚀 Создать проект с этими данными", "figma:new_project")
    .row()
    .text("🎨 Создать Style Guide", "figma:style_guide");
}

// ── /figma [url] ──────────────────────────────────────────────────────────────

export async function handleFigmaCommand(ctx: BotContext): Promise<void> {
  if (!isPrivileged(await getUserRole(BigInt(ctx.from!.id)))) {
    await ctx.reply("Команда доступна только менеджерам и администраторам.");
    return;
  }

  const args = ctx.message?.text?.split(" ").slice(1).join(" ").trim();
  console.log(`[/figma] command received, args="${args}"`);

  if (!args) {
    ctx.session.awaiting_input = "figma_url";
    await ctx.reply("Отправьте ссылку на Figma-файл.");
    return;
  }

  const fileKey = extractFileKeyFromUrl(args);
  console.log(`[/figma] extracted fileKey="${fileKey}"`);

  if (!fileKey) {
    await ctx.reply(
      "Не удалось извлечь ключ файла из ссылки.\nУбедись, что ссылка формата:\n`https://www.figma.com/design/КЛЮЧ/...`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  await processFigmaFile(ctx, fileKey);
}

// ── Shared: load file pages and show page selector ────────────────────────────

export async function processFigmaFile(ctx: BotContext, fileKey: string): Promise<void> {
  console.log(`[figma] processFigmaFile fileKey="${fileKey}"`);
  await ctx.reply("⏳ Загружаю страницы файла Figma...");

  let pages: Array<{ id: string; name: string }>;
  try {
    pages = await getFilePages(fileKey);
    console.log(`[figma] loaded ${pages.length} pages`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[figma] getFilePages error:`, err);
    await ctx.reply(`❌ Ошибка при обращении к Figma API:\n\`${message}\``, {
      parse_mode: "Markdown",
    });
    return;
  }

  if (pages.length === 0) {
    await ctx.reply("В этом файле нет страниц.");
    return;
  }

  ctx.session.figma_file_key = fileKey;

  const keyboard = new InlineKeyboard();
  for (const page of pages) {
    keyboard.text(page.name, `figma:page:${page.id}`).row();
  }

  await ctx.reply(
    `Найдено страниц: *${pages.length}*\nВыбери страницу для извлечения текста:`,
    { reply_markup: keyboard, parse_mode: "Markdown" }
  );
}

// ── Callback: figma:page:{pageId} ─────────────────────────────────────────────

export async function handleFigmaPageSelected(
  ctx: BotContext,
  pageId: string
): Promise<void> {
  await ctx.answerCallbackQuery();
  console.log(`[figma:page] selected pageId="${pageId}"`);

  const fileKey = ctx.session.figma_file_key;
  if (!fileKey) {
    await ctx.reply("Сессия устарела. Запусти команду /figma заново.");
    return;
  }

  const projectId = ctx.session.active_project_id;
  if (!projectId) {
    await ctx.reply(
      "Нет активного проекта. Выбери проект через /projects, затем повтори команду /figma."
    );
    return;
  }

  console.log(`[figma:page] fileKey="${fileKey}", projectId="${projectId}"`);

  // Re-fetch pages to get the name for this pageId reliably
  let pageName = pageId;
  try {
    const pages = await getFilePages(fileKey);
    pageName = pages.find((p) => p.id === pageId)?.name ?? pageId;
  } catch {
    console.warn(`[figma:page] could not re-fetch pages for name lookup`);
  }

  console.log(`[figma:page] pageName="${pageName}"`);
  await ctx.reply(`⏳ Извлекаю текст со страницы «${pageName}»...`);

  let texts: string[];
  try {
    texts = await getPageTextContent(fileKey, pageId);
    console.log(`[figma:page] extracted ${texts.length} text items`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[figma:page] getPageTextContent error:`, err);
    await ctx.reply(`❌ Ошибка при чтении страницы:\n\`${message}\``, {
      parse_mode: "Markdown",
    });
    return;
  }

  if (texts.length === 0) {
    await ctx.reply("На этой странице нет текстовых элементов.");
    return;
  }

  const content = texts.join("\n\n");
  console.log(`[figma:page] content length=${content.length}`);

  // ── Send text in chunks ───────────────────────────────────────────────────

  const chunks = splitIntoChunks(content);
  console.log(`[figma:page] splitting into ${chunks.length} chunk(s)`);

  for (let i = 0; i < chunks.length; i++) {
    const label = chunks.length > 1 ? `📄 Страница «${pageName}» (часть ${i + 1}/${chunks.length}):\n\n` : `📄 Страница «${pageName}»:\n\n`;
    await ctx.reply(label + chunks[i]);
    if (i < chunks.length - 1) await sleep(CHUNK_DELAY_MS);
  }

  await ctx.reply(`📄 Извлечено ${content.length} символов из страницы «${pageName}»`);

  // ── Save full content to DB ───────────────────────────────────────────────

  try {
    await saveFigmaReference({
      projectId,
      figmaFileKey: fileKey,
      pageId,
      pageName,
      content, // full text, no truncation
    });
    console.log(`[figma:page] reference saved to DB, content length=${content.length}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[figma:page] saveFigmaReference error:`, err);
    await ctx.reply(
      `⚠️ Текст показан, но сохранить в БД не удалось:\n\`${message}\`\n\nВозможно, нужно применить миграцию: \`npm run db:push\``,
      { parse_mode: "Markdown" }
    );
    ctx.session.figma_file_key = null;
    return;
  }

  ctx.session.figma_file_key = null;
  ctx.session.pending_figma_text = content;

  const hasProject = !!ctx.session.active_project_id;
  await ctx.reply(
    "Что дальше?",
    { reply_markup: hasProject ? withProjectKeyboard() : withoutProjectKeyboard() }
  );
}

// ── Callback: figma:use_as_brief ──────────────────────────────────────────────

export async function handleFigmaUseAsBrief(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const projectId = ctx.session.active_project_id;
  if (!projectId) {
    await ctx.reply("Нет активного проекта.");
    return;
  }

  const text = ctx.session.pending_figma_text;
  if (!text) {
    await ctx.reply("Данные Figma не найдены. Попробуй извлечь текст ещё раз.");
    return;
  }

  try {
    await appendUploadedDocument(projectId, {
      filename: "figma_export.txt",
      analysis: text,
      addedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(`❌ Не удалось сохранить в бриф:\n${message}`);
    return;
  }

  ctx.session.pending_figma_text = null;

  await ctx.reply(
    "✅ Текст из Figma добавлен в бриф проекта.",
    {
      reply_markup: new InlineKeyboard()
        .text("▶️ Создать бренд-платформу", `module_resume:${ctx.session.current_module ?? 1}`)
        .row()
        .text("📎 Загрузить ещё", "figma:load_more"),
    }
  );
}

// ── Callback: figma:save_ref ──────────────────────────────────────────────────

export async function handleFigmaSaveRef(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  ctx.session.pending_figma_text = null;
  await ctx.reply(
    "Что дальше?",
    { reply_markup: afterExtractionKeyboard() }
  );
}

// ── Callback: figma:new_project ───────────────────────────────────────────────

export async function handleFigmaNewProject(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  ctx.session.awaiting_input = "project_name";
  await ctx.reply("Как назовём проект?");
}

// ── Callback: figma:load_more ─────────────────────────────────────────────────

export async function handleFigmaLoadMore(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    "Отправь ещё одну ссылку на Figma-файл:\n`/figma https://www.figma.com/design/КЛЮЧ/...`",
    { parse_mode: "Markdown" }
  );
}

// ── Callback: figma:style_guide ───────────────────────────────────────────────

export async function handleFigmaStyleGuide(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const projectId = ctx.session.active_project_id;
  if (!projectId) {
    await ctx.reply("Нет активного проекта.");
    return;
  }

  const refs = await getFigmaReferences(projectId);
  if (refs.length === 0) {
    await ctx.reply("Нет сохранённых референсов. Загрузи хотя бы один Figma-файл через /figma.");
    return;
  }

  await ctx.reply(`⏳ Анализирую ${refs.length} референс(ов), создаю Style Guide...`);

  const combinedContent = refs
    .map((r, i) => `=== Референс ${i + 1}: ${r.pageName ?? r.pageId} ===\n${r.content}`)
    .join("\n\n");

  let styleGuideText: string;
  try {
    styleGuideText = await generateWithClaude(
      STYLE_GUIDE_PROMPT,
      combinedContent,
      { projectId, moduleNum: 0, maxTokens: 4000 }
    );
    console.log(`[figma:style_guide] generated, length=${styleGuideText.length}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[figma:style_guide] generation error:`, err);
    await ctx.reply(`❌ Ошибка при генерации Style Guide:\n${message}`);
    return;
  }

  await updateStyleGuide(projectId, styleGuideText);
  console.log(`[figma:style_guide] saved to project ${projectId}`);

  const chunks = splitIntoChunks(`✅ Style Guide создан и сохранён в проект!\n\n${styleGuideText}`);
  for (let i = 0; i < chunks.length; i++) {
    await ctx.reply(chunks[i]);
    if (i < chunks.length - 1) await sleep(CHUNK_DELAY_MS);
  }

  await ctx.reply(
    "Style Guide будет автоматически учитываться во всех последующих модулях этого проекта.",
    {
      reply_markup: new InlineKeyboard()
        .text("📊 Статус проекта", "nav:status")
        .text("🚀 Продолжить работу", `module_resume:${ctx.session.current_module ?? 1}`),
    }
  );
}

// ── /figma_clear ──────────────────────────────────────────────────────────────

export async function handleFigmaClear(ctx: BotContext): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);
  const role = await getUserRole(telegramId);
  if (!isPrivileged(role)) {
    await ctx.reply("Команда доступна только менеджерам и администраторам.");
    return;
  }

  const projectId = ctx.session.active_project_id;

  if (!projectId) {
    await ctx.reply("Нет активного проекта. Выбери проект через /projects.");
    return;
  }

  const count = await deleteFigmaReferences(projectId);
  await ctx.reply(`✅ Удалено ${count} референсов из проекта.`);
}
