import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { generateWithClaude } from "../ai/gateway";
import { getActiveBrief } from "../db/briefs";
import { saveArtifact, getLatestArtifact, approveArtifact } from "../db/artifacts";
import { getLatestModuleRun } from "../db/moduleRuns";
import { updateCurrentModule, updateProjectStatus } from "../db/projects";
import { sendLongMessage } from "../utils/telegram";
import { sendNextStep } from "../utils/nextStep";

const MODULE_NUM = 2;

const SYSTEM_PROMPT = `Ты — senior brand strategist в брендинговой студии.
На основе брифа проекта создай Brand DNA — стратегическую платформу бренда.

Ответь в формате:

🎯 ПОЗИЦИОНИРОВАНИЕ
[Одно-два предложения — суть бренда на рынке]

💎 ЦЕННОСТИ
[3–5 ценностей с описанием каждой в одном предложении]

🤝 ОБЕЩАНИЕ БРЕНДА
[Что бренд обещает своей аудитории]

🎭 АРХЕТИП
[Архетип + почему он подходит]

❤️ ЭМОЦИОНАЛЬНЫЙ ВЕКТОР
[Какие эмоции должен вызывать бренд]

🗣 TONE OF VOICE
[3–4 характеристики голоса + по 2 примера фраз для каждой]

⚔️ ОТЛИЧИЕ ОТ КОНКУРЕНТОВ
[В чём уникальность]

🗺 СМЫСЛОВЫЕ ТЕРРИТОРИИ
[3–4 территории коммуникации]

📌 КОММУНИКАЦИОННЫЕ ОПОРЫ
[3–4 ключевых сообщения]`;

function dnaKeyboard(artifactId: string) {
  return new InlineKeyboard()
    .text("✅ Одобрить", `dna:approve:${artifactId}`)
    .text("✏️ Доработать", `dna:revise:${artifactId}`)
    .row()
    .text("↩️ Вернуться к брифу", "dna:back_to_brief");
}

async function getBriefContent(projectId: string): Promise<string> {
  const brief = await getActiveBrief(projectId);
  if (!brief) throw new Error("Brief not found");

  const data = (brief.data as Record<string, unknown>) ?? {};
  // Prefer structured summary, fall back to raw dialog
  if (brief.summary) return brief.summary;
  if (data.structured) return data.structured as string;

  // Last resort: flatten dialog
  const dialog = (data.dialog as Array<{ role: string; content: string }>) ?? [];
  return dialog.map((m) => `${m.role === "user" ? "Клиент" : "Стратег"}: ${m.content}`).join("\n\n");
}

export async function runBrandDna(ctx: BotContext) {
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await ctx.reply("🧬 Запускаю модуль Brand DNA... Анализирую бриф...");
  await ctx.api.sendChatAction(ctx.chat!.id, "typing");

  const briefContent = await getBriefContent(projectId);
  const dnaText = await generateWithClaude(SYSTEM_PROMPT, briefContent, {
    projectId,
    moduleNum: MODULE_NUM,
    maxTokens: 3000,
  });

  // Fetch the module_run that gateway just saved
  const run = await getLatestModuleRun(projectId, MODULE_NUM);
  if (!run) throw new Error("Module run not saved");

  // Save artifact
  const existing = await getLatestArtifact(projectId, "brand_dna");
  const artifact = await saveArtifact({
    moduleRunId: run.id,
    projectId,
    type: "brand_dna",
    name: "Brand DNA",
    data: { text: dnaText },
    version: existing ? existing.version + 1 : 1,
  });

  // Update project state
  await updateProjectStatus(projectId, "in_progress");
  await updateCurrentModule(projectId, MODULE_NUM);
  ctx.session.current_module = MODULE_NUM;
  ctx.session.awaiting_input = null;

  await sendLongMessage(ctx, `*🧬 Brand DNA*\n\n${dnaText}`);
  await ctx.reply("Что скажете?", { reply_markup: dnaKeyboard(artifact.id) });
}

export async function handleDnaApprove(ctx: BotContext, artifactId: string) {
  await ctx.answerCallbackQuery();

  await approveArtifact(artifactId);

  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await updateCurrentModule(projectId, 3);
  ctx.session.current_module = 3;

  await sendNextStep(ctx, projectId, "✅ *Brand DNA одобрена!*");
}

export async function handleDnaRevise(ctx: BotContext, artifactId: string) {
  await ctx.answerCallbackQuery();
  ctx.session.awaiting_input = "brand_dna_revision";
  ctx.session.module_state = artifactId;
  await ctx.reply("Что хотите изменить?");
}

export async function handleDnaRevisionInput(ctx: BotContext, comment: string) {
  const projectId = ctx.session.active_project_id;
  const artifactId = ctx.session.module_state;
  if (!projectId || !artifactId) return;

  await ctx.api.sendChatAction(ctx.chat!.id, "typing");

  const briefContent = await getBriefContent(projectId);
  const existing = await getLatestArtifact(projectId, "brand_dna");
  const prevText = (existing?.data as Record<string, string> | null)?.text ?? "";

  const userMessage =
    `Бриф проекта:\n${briefContent}\n\n` +
    `Предыдущая версия Brand DNA:\n${prevText}\n\n` +
    `Комментарий клиента:\n${comment}\n\n` +
    `Перегенерируй Brand DNA с учётом комментария, сохранив общую структуру.`;

  const dnaText = await generateWithClaude(SYSTEM_PROMPT, userMessage, {
    projectId,
    moduleNum: MODULE_NUM,
    maxTokens: 3000,
  });

  const run = await getLatestModuleRun(projectId, MODULE_NUM);
  if (!run) throw new Error("Module run not saved");

  const artifact = await saveArtifact({
    moduleRunId: run.id,
    projectId,
    type: "brand_dna",
    name: "Brand DNA",
    data: { text: dnaText },
    version: existing ? existing.version + 1 : 1,
  });

  ctx.session.awaiting_input = null;
  ctx.session.module_state = null;

  await sendLongMessage(ctx, `*🧬 Brand DNA (обновлено)*\n\n${dnaText}`);
  await ctx.reply("Что скажете?", { reply_markup: dnaKeyboard(artifact.id) });
}

export async function handleDnaBackToBrief(ctx: BotContext) {
  await ctx.answerCallbackQuery();

  const keyboard = new InlineKeyboard()
    .text("✅ Всё верно", "brief:approve")
    .text("✏️ Дополнить", "brief:amend")
    .row()
    .text("📄 Скачать", "brief:download");

  await ctx.reply("Возвращаемся к брифу. Хотите что-то изменить?", {
    reply_markup: keyboard,
  });
}
