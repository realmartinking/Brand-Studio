import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { db } from "../db/index";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { saveFigmaReference, countFigmaReferences } from "../db/figmaRefs";

const UPLOADS_DIR = path.resolve("uploads/learn");

// ── Role guard ────────────────────────────────────────────────────────────────

async function isManagerOrAdmin(telegramId: bigint): Promise<boolean> {
  const user = await db.query.users.findFirst({
    where: eq(users.telegramId, telegramId),
    columns: { role: true },
  });
  return user?.role === "manager" || user?.role === "admin";
}

// ── Keyboards ─────────────────────────────────────────────────────────────────

function learnKeyboard() {
  return new InlineKeyboard().text("✅ Создать Style Guide", "figma:style_guide");
}

function afterUploadKeyboard() {
  return new InlineKeyboard()
    .text("📎 Ещё материал", "learn:more")
    .text("✅ Создать Style Guide", "figma:style_guide");
}

// ── /learn ────────────────────────────────────────────────────────────────────

export async function handleLearn(ctx: BotContext): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);

  if (!(await isManagerOrAdmin(telegramId))) {
    await ctx.reply("Команда доступна только менеджерам и администраторам.");
    return;
  }

  ctx.session.awaiting_input = "learn";

  await ctx.reply(
    "📚 Режим обучения стилю студии.\n\n" +
    "Отправляйте материалы для анализа:\n" +
    "• PDF-файлы (бренд-платформы, стратегии, брендбуки)\n" +
    "• Ссылки на проекты в Figma\n\n" +
    "Когда загрузите все материалы — нажмите «Создать Style Guide».",
    { reply_markup: learnKeyboard() }
  );
}

// ── Callback: learn:more ──────────────────────────────────────────────────────

export async function handleLearnMore(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  ctx.session.awaiting_input = "learn";
  await ctx.reply(
    "Отправьте PDF-файл или ссылку /figma для загрузки следующего материала.",
    { reply_markup: learnKeyboard() }
  );
}

// ── PDF document handler ──────────────────────────────────────────────────────

export async function handleLearnDocument(ctx: BotContext): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);

  if (!(await isManagerOrAdmin(telegramId))) {
    await ctx.reply("Команда доступна только менеджерам и администраторам.");
    return;
  }

  const projectId = ctx.session.active_project_id;
  if (!projectId) {
    await ctx.reply("Нет активного проекта. Выбери проект через /projects.");
    return;
  }

  const doc = ctx.message?.document;
  if (!doc) return;

  if (doc.mime_type !== "application/pdf") {
    await ctx.reply("Поддерживаются только PDF-файлы. Отправь файл в формате .pdf");
    return;
  }

  const filename = doc.file_name ?? `upload_${Date.now()}.pdf`;
  await ctx.reply(`⏳ Загружаю PDF «${filename}»...`);

  // ── Download from Telegram ────────────────────────────────────────────────

  let pdfBuffer: Buffer;
  try {
    const file = await ctx.getFile();
    const token = process.env.BOT_TOKEN!;
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    pdfBuffer = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    console.error("[learn:pdf] download error:", err);
    await ctx.reply(`❌ Не удалось скачать файл: ${(err as Error).message}`);
    return;
  }

  // ── Save locally ──────────────────────────────────────────────────────────

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const localPath = path.join(UPLOADS_DIR, `${Date.now()}_${filename}`);
  fs.writeFileSync(localPath, pdfBuffer);

  // ── Extract text ──────────────────────────────────────────────────────────

  let extractedText: string;
  try {
    const data = await pdfParse(pdfBuffer);
    extractedText = data.text.trim();
    console.log(`[learn:pdf] extracted ${extractedText.length} chars from "${filename}"`);
  } catch (err) {
    console.error("[learn:pdf] parse error:", err);
    await ctx.reply(`❌ Не удалось извлечь текст из PDF: ${(err as Error).message}`);
    return;
  }

  if (!extractedText) {
    await ctx.reply("PDF не содержит извлекаемого текста (возможно, это сканированное изображение).");
    return;
  }

  // ── Save to knowledge base ────────────────────────────────────────────────

  try {
    await saveFigmaReference({
      projectId,
      figmaFileKey: "",
      pageId: `pdf:${Date.now()}`,
      pageName: filename,
      content: extractedText,
      source: "pdf",
    });
  } catch (err) {
    console.error("[learn:pdf] save error:", err);
    await ctx.reply(`❌ Не удалось сохранить в базу: ${(err as Error).message}`);
    return;
  }

  const total = await countFigmaReferences(projectId);

  await ctx.reply(
    `✅ PDF «${filename}» загружен (${extractedText.length} символов). Всего материалов: ${total}.`,
    { reply_markup: afterUploadKeyboard() }
  );
}
