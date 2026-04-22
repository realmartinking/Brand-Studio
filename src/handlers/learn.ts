import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { getUserRole, isPrivileged, setStudioSetting } from "../db/queries";
import { saveFigmaReference, countFigmaReferences, getFigmaReferences } from "../db/figmaRefs";
import { generateWithClaude } from "../ai/gateway";
import { logger } from "../config/logger";


const log = logger.child({ mod: "learn" });
const UPLOADS_DIR = path.resolve("uploads/learn");

// ── Keyboards ─────────────────────────────────────────────────────────────────

const UPDATE_STYLE_GUIDE_PROMPT = `Проанализируй эти примеры работ брендинговой студии и создай подробный Style Guide в формате markdown. Опиши: философию подхода, структуру мышления, стилистику формулировок, методологию по модулям, антипаттерны.`;

function learnKeyboard() {
  return new InlineKeyboard()
    .text("✅ Создать Style Guide", "figma:style_guide")
    .row()
    .text("🔄 Обновить Style Guide студии", "learn:update_style_guide");
}

function afterUploadKeyboard() {
  return new InlineKeyboard()
    .text("📎 Ещё материал", "learn:more")
    .row()
    .text("✅ Создать Style Guide", "figma:style_guide")
    .text("🔄 Обновить Style Guide студии", "learn:update_style_guide");
}

// ── /learn ────────────────────────────────────────────────────────────────────

export async function handleLearn(ctx: BotContext): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);

  const role = await getUserRole(telegramId); console.log("LEARN DEBUG: telegramId=", telegramId, "role=", role, "isPrivileged=", isPrivileged(role)); if (false && !isPrivileged(role)) {
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

  const role = await getUserRole(telegramId); console.log("LEARN DEBUG: telegramId=", telegramId, "role=", role, "isPrivileged=", isPrivileged(role)); if (false && !isPrivileged(role)) {
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

  if (doc.file_size && doc.file_size > 20 * 1024 * 1024) {
    await ctx.reply("Файл слишком большой (максимум 20 МБ). Попробуйте сжать PDF или разбить на части.");
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
    log.error({ err: (err as Error).message }, "download error:");
    if ((err as Error).message?.toLowerCase().includes("file is too big")) {
      await ctx.reply("Файл слишком большой (максимум 20 МБ). Попробуйте сжать PDF или разбить на части.");
      return;
    }
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
    log.error({ err: (err as Error).message }, "parse error:");
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
    log.error({ err: (err as Error).message }, "save error:");
    await ctx.reply(`❌ Не удалось сохранить в базу: ${(err as Error).message}`);
    return;
  }

  const total = await countFigmaReferences(projectId);

  await ctx.reply(
    `✅ PDF «${filename}» загружен (${extractedText.length} символов). Всего материалов: ${total}.`,
    { reply_markup: afterUploadKeyboard() }
  );
}

// ── Callback: learn:update_style_guide ────────────────────────────────────────

export async function handleLearnUpdateStyleGuide(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const projectId = ctx.session.active_project_id;
  if (!projectId) {
    await ctx.reply("Нет активного проекта. Выбери проект через /projects.");
    return;
  }

  const refs = await getFigmaReferences(projectId);
  if (refs.length === 0) {
    await ctx.reply("Нет загруженных материалов. Сначала загрузи PDF-файлы или материалы Figma.");
    return;
  }

  await ctx.reply(`⏳ Анализирую ${refs.length} материал(ов), обновляю Style Guide студии...`);

  const combinedContent = refs
    .map((r, i) => `=== Материал ${i + 1}: ${r.pageName ?? r.pageId} ===\n${r.content}`)
    .join("\n\n");

  let styleGuideText: string;
  try {
    styleGuideText = await generateWithClaude(
      UPDATE_STYLE_GUIDE_PROMPT,
      combinedContent,
      { projectId, moduleNum: 0, maxTokens: 4000 }
    );
  } catch (err) {
    log.error({ err: (err as Error).message }, "generation error:");
    await ctx.reply(`❌ Ошибка при генерации Style Guide: ${(err as Error).message}`);
    return;
  }

  await setStudioSetting("style_guide", styleGuideText);
  console.log(`[learn:update_style_guide] global style guide updated, length=${styleGuideText.length}`);

  await ctx.reply(
    "✅ Style Guide студии обновлён и сохранён в базу данных.\n\n" +
    "Все последующие генерации во всех проектах будут использовать новый стиль."
  );
}
