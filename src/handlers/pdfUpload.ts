import pdfParse from "pdf-parse";
import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { generateWithClaude } from "../ai/gateway";
import { getActiveBrief, appendUploadedDocument, appendDialogMessage } from "../db/briefs";
import { sendLongMessage } from "../utils/telegram";

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
    await ctx.reply(`❌ Не удалось скачать файл: ${(err as Error).message}`);
    return;
  }

  // ── Extract text ──────────────────────────────────────────────────────────

  let extractedText: string;
  try {
    const data = await pdfParse(pdfBuffer);
    extractedText = data.text.trim();
  } catch (err) {
    console.error("[pdfUpload] parse error:", err);
    await ctx.reply(`❌ Не удалось прочитать PDF: ${(err as Error).message}`);
    return;
  }

  if (!extractedText) {
    await ctx.reply("PDF не содержит извлекаемого текста (возможно, это сканированное изображение).");
    return;
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

  // Persist to brief.data.uploaded_documents[]
  await appendUploadedDocument(projectId, {
    filename,
    analysis,
    addedAt: new Date().toISOString(),
  });

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
