import fs from "fs";
import path from "path";
import { InlineKeyboard, InputFile } from "grammy";
import { BotContext } from "../types";
import { generateWithClaude } from "../ai/gateway";
import { getActiveBrief } from "../db/briefs";
import { saveArtifact, getLatestArtifact, approveArtifact } from "../db/artifacts";
import { getLatestModuleRun } from "../db/moduleRuns";
import { updateProjectStatus } from "../db/projects";
import { sendLongMessage } from "../utils/telegram";

const MODULE_NUM = 6;
const OUTPUTS_DIR = path.resolve("outputs");

// ── System prompts ────────────────────────────────────────────────────────────

const FULL_REPORT_PROMPT = `Собери все материалы проекта в единый структурированный документ.
Оформи как профессиональную брендинговую презентацию в текстовом формате.

Структура:
1. 📋 ОБЗОР ПРОЕКТА (из брифа)
2. 🧬 СТРАТЕГИЧЕСКАЯ ПЛАТФОРМА (Brand DNA)
3. 🏷 НЕЙМИНГ И ВЕРБАЛЬНАЯ СИСТЕМА
4. 🎨 КОНЦЕПТУАЛЬНОЕ НАПРАВЛЕНИЕ
5. 🖼 ВИЗУАЛЬНАЯ ИДЕНТИЧНОСТЬ
6. 📌 РЕКОМЕНДАЦИИ ПО СЛЕДУЮЩИМ ШАГАМ

Используй чистое форматирование. Документ должен читаться как готовый клиентский deliverable.`;

const SUMMARY_PROMPT = `На основе всех материалов проекта создай краткую сводку бренда (one-pager).
Максимум 15 предложений. Охвати: суть бизнеса, позиционирование, ценности, аудиторию,
название, визуальный характер. Это должно быть ёмкое описание, которое можно передать
любому подрядчику для быстрого понимания бренда.`;

// ── Artifact collector ────────────────────────────────────────────────────────

async function collectMaterials(projectId: string): Promise<string> {
  const brief = await getActiveBrief(projectId);
  const dna = await getLatestArtifact(projectId, "brand_dna");
  const verbal = await getLatestArtifact(projectId, "verbal_system");
  const concept = await getLatestArtifact(projectId, "concept_direction");
  const visual = await getLatestArtifact(projectId, "visual_identity");

  const get = (
    artifact: Awaited<ReturnType<typeof getLatestArtifact>>,
    keys: string[]
  ): string => {
    if (!artifact?.data) return "Не найдено";
    const d = artifact.data as Record<string, string>;
    for (const k of keys) if (d[k]) return d[k];
    return "Не найдено";
  };

  const verbalData = verbal?.data as Record<string, string> | null;
  const conceptData = concept?.data as Record<string, string> | null;

  return [
    `=== БРИФ ===\n${brief?.summary ?? "Не найден"}`,
    `=== BRAND DNA ===\n${get(dna, ["text"])}`,
    `=== НАЗВАНИЕ: ${verbalData?.selectedName ?? ""} ===`,
    `=== ВЕРБАЛЬНАЯ СИСТЕМА ===\n${verbalData?.verbal ?? verbalData?.naming ?? "Не найдена"}`,
    `=== ВЫБРАННАЯ КОНЦЕПЦИЯ ===\n${conceptData?.selectedConcept ?? conceptData?.concepts ?? "Не найдена"}`,
    `=== VISUAL IDENTITY ===\n${get(visual, ["text"])}`,
  ].join("\n\n");
}

// ── File saver ────────────────────────────────────────────────────────────────

function saveMarkdown(projectId: string, content: string): string {
  const dir = path.join(OUTPUTS_DIR, projectId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "brand-book.md");
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// ── Keyboards ─────────────────────────────────────────────────────────────────

function afterFullReportKeyboard() {
  return new InlineKeyboard()
    .text("📄 Скачать ещё раз", "deliver:download_again")
    .row()
    .text("🔄 Вернуться к модулю", "deliver:back_to_module")
    .text("🚀 Новый проект", "new_project");
}

function afterSummaryKeyboard() {
  return new InlineKeyboard()
    .text("📄 Полный отчёт", "deliver:full_report")
    .text("🚀 Новый проект", "new_project");
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runDeliverables(ctx: BotContext) {
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await ctx.reply("📦 Собираю все материалы проекта...");

  const materials = await collectMaterials(projectId);
  ctx.session.module_state = "materials_ready";
  ctx.session.awaiting_input = null;
  ctx.session.current_module = MODULE_NUM;

  const keyboard = new InlineKeyboard()
    .text("📄 Полный отчёт", "deliver:full_report")
    .text("📋 Краткая сводка", "deliver:summary");

  await ctx.reply(
    "✅ Все материалы собраны! Что хотите получить?",
    { reply_markup: keyboard }
  );
}

// ── Full report ───────────────────────────────────────────────────────────────

export async function handleFullReport(ctx: BotContext) {
  await ctx.answerCallbackQuery();

  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await ctx.reply("📄 Формирую полный отчёт...");
  await ctx.api.sendChatAction(ctx.chat!.id, "typing");

  const materials = await collectMaterials(projectId);
  const reportText = await generateWithClaude(FULL_REPORT_PROMPT, materials, {
    projectId,
    moduleNum: MODULE_NUM,
    maxTokens: 4000,
  });

  // Save to filesystem
  const filePath = saveMarkdown(projectId, reportText);

  // Save artifact
  const run = await getLatestModuleRun(projectId, MODULE_NUM);
  if (!run) throw new Error("Module run not saved");

  const existing = await getLatestArtifact(projectId, "deliverable");
  const artifact = await saveArtifact({
    moduleRunId: run.id,
    projectId,
    type: "deliverable",
    name: "Brand Book",
    data: { text: reportText, filePath },
    version: existing ? existing.version + 1 : 1,
  });

  await approveArtifact(artifact.id);
  await updateProjectStatus(projectId, "completed");
  ctx.session.module_state = artifact.id;

  // Send text (split if long)
  await sendLongMessage(ctx, `*📄 Полный отчёт по бренду*\n\n${reportText}`);

  // Send as file
  const buffer = fs.readFileSync(filePath);
  await ctx.replyWithDocument(new InputFile(buffer, "brand-book.md"), {
    caption: "Brand Book — полная версия",
  });

  await ctx.reply(
    "🎉 Проект завершён! Brand Book готов.",
    { reply_markup: afterFullReportKeyboard() }
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────

export async function handleSummary(ctx: BotContext) {
  await ctx.answerCallbackQuery();

  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await ctx.reply("📋 Формирую краткую сводку...");
  await ctx.api.sendChatAction(ctx.chat!.id, "typing");

  const materials = await collectMaterials(projectId);
  const summaryText = await generateWithClaude(SUMMARY_PROMPT, materials, {
    projectId,
    moduleNum: MODULE_NUM,
    maxTokens: 1000,
  });

  await ctx.reply(`*📋 Сводка бренда*\n\n${summaryText}`, {
    parse_mode: "Markdown",
    reply_markup: afterSummaryKeyboard(),
  });
}

// ── Download again ────────────────────────────────────────────────────────────

export async function handleDownloadAgain(ctx: BotContext) {
  await ctx.answerCallbackQuery();

  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  const artifact = await getLatestArtifact(projectId, "deliverable");
  const filePath = (artifact?.data as Record<string, string> | null)?.filePath;

  if (!filePath || !fs.existsSync(filePath)) {
    await ctx.reply("Файл не найден. Попробуйте сгенерировать отчёт заново.");
    await handleFullReport(ctx);
    return;
  }

  const buffer = fs.readFileSync(filePath);
  await ctx.replyWithDocument(new InputFile(buffer, "brand-book.md"), {
    caption: "Brand Book — полная версия",
  });
}

// ── Back to module (show format choice again) ─────────────────────────────────

export async function handleBackToDeliverables(ctx: BotContext) {
  await ctx.answerCallbackQuery();

  const keyboard = new InlineKeyboard()
    .text("📄 Полный отчёт", "deliver:full_report")
    .text("📋 Краткая сводка", "deliver:summary");

  await ctx.reply("Выберите формат:", { reply_markup: keyboard });
}
