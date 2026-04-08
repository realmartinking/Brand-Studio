import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import sharp from "sharp";
import pdfParse from "pdf-parse";
import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { generateWithClaude } from "../ai/gateway";
import { claude, CLAUDE_MODEL } from "../ai/claude";
import { getActiveBrief, appendUploadedDocument, appendDialogMessage, completeBrief, getUploadedDocumentsContext, saveStructuredBrief } from "../db/briefs";
import { sendLongMessage } from "../utils/telegram";

const execFileAsync = promisify(execFile);

const ANALYSIS_PROMPT = `Проанализируй этот документ. Определи:
1. Тип документа (бренд-платформа, исследование рынка, брендбук, презентация, бриф, другое)
2. Извлеки ключевую информацию: суть проекта, аудитория, позиционирование, ценности, конкуренты, ограничения
3. Какие данные из этого документа полезны для текущего проекта?

Ответь структурированно.

В конце добавь строго одну из двух строк:
BRIEF_SUFFICIENT: да
BRIEF_SUFFICIENT: нет`;

// ── Keyboards ─────────────────────────────────────────────────────────────────

function afterAnalysisKeyboard(briefSufficient: boolean, briefComplete: boolean) {
  const kb = new InlineKeyboard()
    .text("✅ Да, использовать", "doc:use")
    .text("❌ Не использовать", "doc:skip")
    .row()
    .text("📎 Загрузить ещё файл", "doc:more");

  if (briefSufficient && !briefComplete) {
    kb.row().text("⏩ Пропустить брифинг → Brand DNA", "doc:brief_skip");
  }

  return kb;
}

// ── Image compression helper ──────────────────────────────────────────────────

async function compressImage(inputPath: string): Promise<Buffer> {
  let quality = 80;
  let buffer = await sharp(inputPath).jpeg({ quality }).toBuffer();

  while (buffer.length > 4 * 1024 * 1024 && quality > 20) {
    quality -= 15;
    buffer = await sharp(inputPath).jpeg({ quality }).toBuffer();
  }

  if (buffer.length > 4 * 1024 * 1024) {
    buffer = await sharp(inputPath)
      .resize(1200, 1600, { fit: "inside" })
      .jpeg({ quality: 60 })
      .toBuffer();
  }

  return buffer;
}

// ── Vision OCR for scanned PDFs ───────────────────────────────────────────────

async function extractTextFromScannedPdf(
  pdfBuffer: Buffer,
  numpages: number
): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bs-ocr-"));
  try {
    const pdfPath = path.join(tmpDir, "input.pdf");
    const outPrefix = path.join(tmpDir, "page");
    fs.writeFileSync(pdfPath, pdfBuffer);

    const pageLimit = Math.min(numpages, 5);
    await execFileAsync("pdftoppm", [
      "-r", "150",
      "-png",
      "-l", String(pageLimit),
      pdfPath,
      outPrefix,
    ]);

    const pngFiles = fs.readdirSync(tmpDir)
      .filter((f) => f.startsWith("page") && f.endsWith(".png"))
      .sort();

    const pageTexts: string[] = [];
    for (const file of pngFiles) {
      const compressed = await compressImage(path.join(tmpDir, file));
      const base64 = compressed.toString("base64");

      const res = await claude.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        messages: [{
          role: "user",
          content: [
            {
              type: "image" as const,
              source: { type: "base64" as const, media_type: "image/jpeg" as const, data: base64 },
            },
            {
              type: "text" as const,
              text: "Извлеки весь текст с этого изображения. Если есть визуальные элементы (логотипы, схемы, мудборды) — опиши их.",
            },
          ],
        }],
      });

      pageTexts.push((res.content[0] as { type: string; text: string }).text);
    }

    return pageTexts.join("\n\n---\n\n");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleProjectDocument(ctx: BotContext): Promise<void> {
  const projectId = ctx.session.active_project_id;
  if (!projectId) return; // guard — index.ts already checks this

  const doc = ctx.message?.document;
  if (!doc) return;

  if (doc.mime_type !== "application/pdf") {
    await ctx.reply("Поддерживаются только PDF-файлы.");
    return;
  }

  if (doc.file_size && doc.file_size > 20 * 1024 * 1024) {
    await ctx.reply("Файл слишком большой (максимум 20 МБ). Попробуйте сжать PDF или разбить на части.");
    return;
  }

  const filename = doc.file_name ?? `document_${Date.now()}.pdf`;
  await ctx.reply(`⏳ Читаю PDF «${filename}»...`);

  // ── Download ──────────────────────────────────────────────────────────────

  let pdfBuffer: Buffer;
  try {
    const file = await ctx.getFile();
    const token = process.env.BOT_TOKEN!;
    const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    pdfBuffer = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    console.error("[pdfUpload] download error:", err);
    if ((err as Error).message?.toLowerCase().includes("file is too big")) {
      await ctx.reply("Файл слишком большой (максимум 20 МБ). Попробуйте сжать PDF или разбить на части.");
      return;
    }
    await ctx.reply(`❌ Не удалось скачать файл: ${(err as Error).message}`);
    return;
  }

  // ── Extract text ──────────────────────────────────────────────────────────

  let extractedText: string;
  let numpages = 1;
  try {
    const data = await pdfParse(pdfBuffer);
    extractedText = data.text.trim();
    numpages = data.numpages;
  } catch (err) {
    console.error("[pdfUpload] parse error:", err);
    await ctx.reply(`❌ Не удалось прочитать PDF: ${(err as Error).message}`);
    return;
  }

  if (!extractedText || extractedText.length < 50) {
    await ctx.reply("📷 Обычный текст не найден — похоже, это скан. Читаю через Vision API...");
    await ctx.api.sendChatAction(ctx.chat!.id, "typing");
    await ctx.reply("💭 Думаю...");
    try {
      extractedText = await extractTextFromScannedPdf(pdfBuffer, numpages);
    } catch (err) {
      console.error("[pdfUpload] vision OCR error:", err);
    }
    if (!extractedText || extractedText.trim().length === 0) {
      await ctx.reply("PDF не содержит извлекаемого текста (возможно, это сканированное изображение).");
      return;
    }
  }

  await ctx.api.sendChatAction(ctx.chat!.id, "typing");

  // ── Analyse with Claude ───────────────────────────────────────────────────

  let analysis: string;
  try {
    analysis = await generateWithClaude(ANALYSIS_PROMPT, extractedText, {
      projectId,
      moduleNum: 0,
      maxTokens: 2000,
    });
  } catch (err) {
    console.error("[pdfUpload] analysis error:", err);
    await ctx.reply(`❌ Ошибка анализа документа: ${(err as Error).message}`);
    return;
  }

  // Parse BRIEF_SUFFICIENT flag and strip it from displayed analysis
  const briefSufficientMatch = analysis.match(/BRIEF_SUFFICIENT:\s*(да|нет)/i);
  const briefSufficient = briefSufficientMatch?.[1]?.toLowerCase() === "да";
  const displayAnalysis = analysis.replace(/\n?BRIEF_SUFFICIENT:\s*(да|нет)\s*$/i, "").trim();

  // Store pending doc in session for "use data" callback
  ctx.session.pending_doc_analysis = displayAnalysis;
  ctx.session.pending_doc_filename = filename;

  // Check if brief is already complete
  const brief = await getActiveBrief(projectId);
  const briefComplete = brief?.status === "complete";

  // ── Show analysis + action buttons ───────────────────────────────────────

  await sendLongMessage(ctx, `📄 *Анализ документа «${filename}»:*\n\n${displayAnalysis}`, {
    parse_mode: "Markdown",
  });

  if (briefSufficient && !briefComplete) {
    await ctx.reply(
      "Из документа извлечено достаточно данных для брифа. Хотите пропустить брифинг и сразу перейти к Brand DNA?",
      { reply_markup: afterAnalysisKeyboard(briefSufficient, briefComplete) }
    );
  } else {
    await ctx.reply(
      "Хотите использовать эти данные для текущего модуля?",
      { reply_markup: afterAnalysisKeyboard(briefSufficient, briefComplete) }
    );
  }
}

// ── doc:use ───────────────────────────────────────────────────────────────────

export async function handleDocUse(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const projectId = ctx.session.active_project_id;
  const analysis = ctx.session.pending_doc_analysis;
  const filename = ctx.session.pending_doc_filename;

  if (!projectId || !analysis || !filename) {
    await ctx.reply("Нет данных для сохранения. Загрузи документ повторно.");
    return;
  }

  // Persist to briefs.data.uploaded_documents[] for projectId
  console.log("[pdfUpload] saving to uploaded_documents, projectId:", projectId, "filename:", filename, "analysisLen:", analysis.length);
  await appendUploadedDocument(projectId, {
    filename,
    analysis,
    addedAt: new Date().toISOString(),
  });

  // Mark brief as complete so module 1 is counted as done in getProjectState
  await completeBrief(projectId);

  // Генерировать summary из загруженных документов если его ещё нет
  const briefAfterComplete = await getActiveBrief(projectId);
  if (briefAfterComplete && !briefAfterComplete.summary) {
    const docsContext = await getUploadedDocumentsContext(projectId);
    if (docsContext) {
      const summaryText = await generateWithClaude(
        "Ты — brand-стратег. На основе предоставленных материалов создай структурированный бриф проекта. " +
        "Формат: Суть проекта, Продукт/Услуга, Целевая аудитория, Рынок и конкуренты, Ценности, Цели. " +
        "Используй ТОЛЬКО информацию из документов. Если чего-то не хватает — отметь как '[не указано]'.",
        docsContext,
        { projectId, moduleNum: 1, maxTokens: 2000 }
      );
      await saveStructuredBrief(projectId, summaryText);
    }
  }

  // If currently in briefing — inject as dialog message so Claude sees it immediately
  if (ctx.session.awaiting_input === "briefing") {
    await appendDialogMessage(projectId, {
      role: "user",
      content: `[Загружен документ «${filename}»]\n\n${analysis}`,
    });
  }

  ctx.session.pending_doc_analysis = null;
  ctx.session.pending_doc_filename = null;

  await ctx.reply(
    `✅ Данные из «${filename}» добавлены в контекст проекта.\n` +
    "Они будут автоматически учитываться при генерации всех последующих модулей."
  );

  const nextKeyboard = new InlineKeyboard()
    .text("▶️ Создать бренд-платформу", "module:2:start")
    .row()
    .text("📎 Загрузить ещё файл", "doc:more")
    .text("💬 Дополнить брифингом", "module:1:start");

  await ctx.reply("Что дальше?", { reply_markup: nextKeyboard });
}

// ── doc:skip ──────────────────────────────────────────────────────────────────

export async function handleDocSkip(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  ctx.session.pending_doc_analysis = null;
  ctx.session.pending_doc_filename = null;
  await ctx.reply("Данные из документа не сохранены.");
}

// ── doc:more ──────────────────────────────────────────────────────────────────

export async function handleDocMore(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  await ctx.reply("Отправьте следующий PDF-файл.");
}

// ── doc:brief_skip ────────────────────────────────────────────────────────────

export async function handleDocBriefSkip(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const projectId = ctx.session.active_project_id;
  const analysis = ctx.session.pending_doc_analysis;
  const filename = ctx.session.pending_doc_filename;

  if (!projectId) return;

  // Save document data before skipping
  if (analysis && filename) {
    await appendUploadedDocument(projectId, {
      filename,
      analysis,
      addedAt: new Date().toISOString(),
    });
  }

  ctx.session.pending_doc_analysis = null;
  ctx.session.pending_doc_filename = null;
  ctx.session.awaiting_input = null;

  // Complete the brief automatically and proceed to Brand DNA
  const { completeBrief } = await import("../db/briefs");
  await completeBrief(projectId);

  // Генерировать summary из загруженных документов если его ещё нет
  const briefForSkip = await getActiveBrief(projectId);
  if (briefForSkip && !briefForSkip.summary) {
    const docsContext = await getUploadedDocumentsContext(projectId);
    if (docsContext) {
      const summaryText = await generateWithClaude(
        "Ты — brand-стратег. На основе предоставленных материалов создай структурированный бриф проекта. " +
        "Формат: Суть проекта, Продукт/Услуга, Целевая аудитория, Рынок и конкуренты, Ценности, Цели. " +
        "Используй ТОЛЬКО информацию из документов. Если чего-то не хватает — отметь как '[не указано]'.",
        docsContext,
        { projectId, moduleNum: 1, maxTokens: 2000 }
      );
      await saveStructuredBrief(projectId, summaryText);
    }
  }

  await ctx.reply("⏩ Бриф заполнен из документа. Запускаю Brand DNA...");

  const { runBrandDna } = await import("../modules/brandDna");
  await runBrandDna(ctx);
}

// ── doc:brief_continue ────────────────────────────────────────────────────────

export async function handleDocBriefContinue(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const projectId = ctx.session.active_project_id;
  const analysis = ctx.session.pending_doc_analysis;
  const filename = ctx.session.pending_doc_filename;

  if (projectId && analysis && filename) {
    await appendUploadedDocument(projectId, {
      filename,
      analysis,
      addedAt: new Date().toISOString(),
    });
  }

  ctx.session.pending_doc_analysis = null;
  ctx.session.pending_doc_filename = null;
  ctx.session.awaiting_input = "briefing";

  await ctx.reply("Хорошо, продолжаем брифинг. Данные из документа добавлены как контекст.");
}

// ── Photo / image message handler ─────────────────────────────────────────────

export async function handlePhotoMessage(ctx: BotContext): Promise<void> {
  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) return;

  // Telegram provides multiple sizes; last is highest resolution
  const photo = photos[photos.length - 1];

  await ctx.reply("📷 Читаю изображение...");
  await ctx.api.sendChatAction(ctx.chat!.id, "typing");
  await ctx.reply("💭 Думаю...");

  let imageBuffer: Buffer;
  try {
    const file = await ctx.api.getFile(photo.file_id);
    const token = process.env.BOT_TOKEN!;
    const response = await fetch(
      `https://api.telegram.org/file/bot${token}/${file.file_path}`
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    imageBuffer = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    console.error("[vision] download error:", err);
    await ctx.reply(`❌ Не удалось скачать изображение: ${(err as Error).message}`);
    return;
  }

  let description: string;
  try {
    let compressed = imageBuffer;
    if (imageBuffer.length > 4 * 1024 * 1024) {
      let quality = 80;
      compressed = await sharp(imageBuffer).jpeg({ quality }).toBuffer();
      while (compressed.length > 4 * 1024 * 1024 && quality > 20) {
        quality -= 15;
        compressed = await sharp(imageBuffer).jpeg({ quality }).toBuffer();
      }
      if (compressed.length > 4 * 1024 * 1024) {
        compressed = await sharp(imageBuffer)
          .resize(1200, 1600, { fit: "inside" })
          .jpeg({ quality: 60 })
          .toBuffer();
      }
    }
    const base64 = compressed.toString("base64");
    const res = await claude.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          {
            type: "image" as const,
            source: { type: "base64" as const, media_type: "image/jpeg" as const, data: base64 },
          },
          {
            type: "text" as const,
            text: "Опиши это изображение. Если есть текст — извлеки его. Если это мудборд, логотип или дизайн — опиши стиль, цвета, композицию.",
          },
        ],
      }],
    });
    description = (res.content[0] as { type: string; text: string }).text;
  } catch (err) {
    console.error("[vision] Claude API error:", err);
    await ctx.reply("❌ Не удалось обработать изображение.");
    return;
  }

  const projectId = ctx.session.active_project_id;

  await sendLongMessage(ctx, `🖼 *Анализ изображения:*\n\n${description}`, {
    parse_mode: "Markdown",
  });

  if (projectId) {
    ctx.session.pending_doc_analysis = description;
    ctx.session.pending_doc_filename = "Изображение";

    const kb = new InlineKeyboard()
      .text("✅ Добавить в проект", "doc:use")
      .text("❌ Нет", "doc:skip");

    await ctx.reply("Хотите добавить это описание в контекст проекта?", { reply_markup: kb });
  }
}
