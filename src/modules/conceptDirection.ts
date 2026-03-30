import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { generateWithClaude } from "../ai/gateway";
import { getActiveBrief } from "../db/briefs";
import { saveArtifact, getLatestArtifact, approveArtifact } from "../db/artifacts";
import { getLatestModuleRun } from "../db/moduleRuns";
import { updateCurrentModule } from "../db/projects";
import { sendLongMessage } from "../utils/telegram";
import { sendNextStep } from "../utils/nextStep";

const MODULE_NUM = 4;

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Ты — креативный директор брендинговой студии.
На основе стратегической платформы, нейминга и вербальной системы
предложи 3–5 концептуальных направлений развития бренда.

Каждое направление — это целостная творческая идея, которая
объединяет смысл, визуальный язык и коммуникацию.

Для каждого направления:

🎨 КОНЦЕПЦИЯ [номер]: «[Название концепции]»

📖 Суть: [2–3 предложения]
🎭 Характер: [какой характер бренда в этой концепции]
🖼 Визуальная метафора: [ключевой визуальный образ]
📝 Словесный мир: [как бренд говорит в этой концепции]
📐 Как это живёт: [примеры — сайт, упаковка, соцсети, пространство]
💪 Сила направления: [почему это может работать]
⚠️ Риски: [возможные слабости]`;

// ── Input builder ─────────────────────────────────────────────────────────────

async function buildInput(projectId: string): Promise<string> {
  const brief = await getActiveBrief(projectId);
  const dna = await getLatestArtifact(projectId, "brand_dna");
  const verbal = await getLatestArtifact(projectId, "verbal_system");

  const briefText = brief?.summary ?? "Бриф не найден";
  const dnaText = (dna?.data as Record<string, string> | null)?.text ?? "Brand DNA не найдена";
  const verbalData = verbal?.data as Record<string, string> | null;
  const verbalText = verbalData?.verbal ?? verbalData?.naming ?? "Вербальная система не найдена";
  const selectedName = verbalData?.selectedName ?? "";

  return (
    `БРИФ:\n${briefText}\n\n` +
    `BRAND DNA:\n${dnaText}\n\n` +
    `НАЗВАНИЕ БРЕНДА: ${selectedName}\n\n` +
    `ВЕРБАЛЬНАЯ СИСТЕМА:\n${verbalText}`
  );
}

// ── Concept parser ────────────────────────────────────────────────────────────

/**
 * Splits the generated text into individual concepts by the 🎨 marker.
 */
function parseConcepts(text: string): string[] {
  const parts = text.split(/(?=🎨\s*КОНЦЕПЦИЯ)/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

// ── Keyboards ─────────────────────────────────────────────────────────────────

function conceptsKeyboard() {
  return new InlineKeyboard()
    .text("⭐ Выбрать концепцию", "concept:select")
    .row()
    .text("🔄 Другие направления", "concept:more")
    .text("✏️ Доработать", "concept:revise");
}

function selectedConceptKeyboard(artifactId: string) {
  return new InlineKeyboard()
    .text("✅ Одобрить", `concept:approve:${artifactId}`)
    .text("✏️ Доработать", `concept:revise_selected:${artifactId}`)
    .row()
    .text("↩️ Назад к концепциям", "concept:back");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sendConcepts(ctx: BotContext, conceptsText: string) {
  const concepts = parseConcepts(conceptsText);

  if (concepts.length === 0) {
    await sendLongMessage(ctx, conceptsText, { parse_mode: undefined });
    return;
  }

  for (const concept of concepts) {
    await sendLongMessage(ctx, concept, { parse_mode: undefined });
  }
}

async function generate(
  projectId: string,
  userMessage: string
): Promise<{ text: string; artifactId: string }> {
  const text = await generateWithClaude(SYSTEM_PROMPT, userMessage, {
    projectId,
    moduleNum: MODULE_NUM,
    maxTokens: 4000,
  });

  const run = await getLatestModuleRun(projectId, MODULE_NUM);
  if (!run) throw new Error("Module run not saved");

  const existing = await getLatestArtifact(projectId, "concept_direction");
  const artifact = await saveArtifact({
    moduleRunId: run.id,
    projectId,
    type: "concept_direction",
    name: "Concept Directions",
    data: { stage: "generated", concepts: text },
    version: existing ? existing.version + 1 : 1,
  });

  return { text, artifactId: artifact.id };
}

// ── Run ───────────────────────────────────────────────────────────────────────

export async function runConceptDirection(ctx: BotContext) {
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await ctx.reply("🎨 Запускаю модуль Concept Direction... Разрабатываю концепции...");
  await ctx.api.sendChatAction(ctx.chat!.id, "typing");

  const input = await buildInput(projectId);
  const { text, artifactId } = await generate(projectId, input);

  ctx.session.current_module = MODULE_NUM;
  ctx.session.module_state = artifactId;
  ctx.session.awaiting_input = null;

  await sendConcepts(ctx, text);
  await ctx.reply("Выберите действие:", { reply_markup: conceptsKeyboard() });
}

// ── More ──────────────────────────────────────────────────────────────────────

export async function handleConceptMore(ctx: BotContext) {
  await ctx.answerCallbackQuery();
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await ctx.reply("🔄 Генерирую новые концепции...");
  await ctx.api.sendChatAction(ctx.chat!.id, "typing");

  const input = await buildInput(projectId);
  const existing = await getLatestArtifact(projectId, "concept_direction");
  const prevConcepts = (existing?.data as Record<string, string> | null)?.concepts ?? "";

  const { text, artifactId } = await generate(
    projectId,
    `${input}\n\nПредыдущие концепции (не повторяй):\n${prevConcepts}`
  );

  ctx.session.module_state = artifactId;

  await sendConcepts(ctx, text);
  await ctx.reply("Выберите действие:", { reply_markup: conceptsKeyboard() });
}

// ── Revise all ────────────────────────────────────────────────────────────────

export async function handleConceptRevise(ctx: BotContext) {
  await ctx.answerCallbackQuery();
  ctx.session.awaiting_input = "concept_revision";
  await ctx.reply("Что хотите изменить? Укажите пожелания по направлениям, стилю или акцентам.");
}

export async function handleConceptRevisionInput(ctx: BotContext, comment: string) {
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await ctx.api.sendChatAction(ctx.chat!.id, "typing");

  const input = await buildInput(projectId);
  const existing = await getLatestArtifact(projectId, "concept_direction");
  const prevConcepts = (existing?.data as Record<string, string> | null)?.concepts ?? "";

  const { text, artifactId } = await generate(
    projectId,
    `${input}\n\nПредыдущие концепции:\n${prevConcepts}\n\nКомментарий:\n${comment}\n\nПерегенерируй с учётом комментария.`
  );

  ctx.session.module_state = artifactId;
  ctx.session.awaiting_input = null;

  await sendConcepts(ctx, text);
  await ctx.reply("Выберите действие:", { reply_markup: conceptsKeyboard() });
}

// ── Select ────────────────────────────────────────────────────────────────────

export async function handleConceptSelect(ctx: BotContext) {
  await ctx.answerCallbackQuery();
  ctx.session.awaiting_input = "concept_select";
  await ctx.reply(
    "Напишите номер понравившейся концепции.\n\n_Например: «1» или «Концепция 3»_",
    { parse_mode: "Markdown" }
  );
}

export async function handleConceptSelectInput(ctx: BotContext, selection: string) {
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  ctx.session.awaiting_input = null;

  const existing = await getLatestArtifact(projectId, "concept_direction");
  const allConcepts = (existing?.data as Record<string, string> | null)?.concepts ?? "";

  // Find the selected concept in the text
  const concepts = parseConcepts(allConcepts);
  const num = parseInt(selection.replace(/\D/g, ""), 10);
  const selectedText =
    !isNaN(num) && concepts[num - 1]
      ? concepts[num - 1]
      : concepts.find((c) => c.toLowerCase().includes(selection.toLowerCase())) ??
        allConcepts;

  const run = await getLatestModuleRun(projectId, MODULE_NUM);
  if (!run) throw new Error("Module run not saved");

  const artifact = await saveArtifact({
    moduleRunId: run.id,
    projectId,
    type: "concept_direction",
    name: `Concept Direction — выбор ${selection}`,
    data: {
      stage: "selected",
      concepts: allConcepts,
      selectedNum: selection,
      selectedConcept: selectedText,
    },
    version: existing ? existing.version + 1 : 1,
  });

  ctx.session.module_state = artifact.id;

  await ctx.reply(`*Выбрана концепция:*\n\n${selectedText}`, {
    parse_mode: "Markdown",
    reply_markup: selectedConceptKeyboard(artifact.id),
  });
}

// ── Approve ───────────────────────────────────────────────────────────────────

export async function handleConceptApprove(ctx: BotContext, artifactId: string) {
  await ctx.answerCallbackQuery();

  await approveArtifact(artifactId);

  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await updateCurrentModule(projectId, 5);
  ctx.session.current_module = 5;
  ctx.session.module_state = null;

  await sendNextStep(ctx, projectId, "✅ *Концептуальное направление одобрено!*");
}

// ── Revise selected ───────────────────────────────────────────────────────────

export async function handleConceptReviseSelected(ctx: BotContext, artifactId: string) {
  await ctx.answerCallbackQuery();
  ctx.session.awaiting_input = "concept_selected_revision";
  ctx.session.module_state = artifactId;
  await ctx.reply("Что хотите изменить в выбранной концепции?");
}

export async function handleConceptSelectedRevisionInput(
  ctx: BotContext,
  comment: string
) {
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await ctx.api.sendChatAction(ctx.chat!.id, "typing");

  const existing = await getLatestArtifact(projectId, "concept_direction");
  const data = (existing?.data as Record<string, string>) ?? {};
  const prevConcept = data.selectedConcept ?? "";
  const input = await buildInput(projectId);

  const revisedText = await generateWithClaude(
    SYSTEM_PROMPT,
    `${input}\n\nВыбранная концепция для доработки:\n${prevConcept}\n\nКомментарий:\n${comment}\n\nПерегенерируй ТОЛЬКО эту концепцию с учётом комментария, сохрани формат.`,
    { projectId, moduleNum: MODULE_NUM, maxTokens: 2000 }
  );

  const run = await getLatestModuleRun(projectId, MODULE_NUM);
  if (!run) throw new Error("Module run not saved");

  const artifact = await saveArtifact({
    moduleRunId: run.id,
    projectId,
    type: "concept_direction",
    name: `Concept Direction — доработка`,
    data: {
      stage: "selected",
      concepts: data.concepts ?? "",
      selectedNum: data.selectedNum ?? "",
      selectedConcept: revisedText,
    },
    version: existing ? existing.version + 1 : 1,
  });

  ctx.session.awaiting_input = null;
  ctx.session.module_state = artifact.id;

  await ctx.reply(`*Концепция (обновлено):*\n\n${revisedText}`, {
    parse_mode: "Markdown",
    reply_markup: selectedConceptKeyboard(artifact.id),
  });
}

// ── Back ──────────────────────────────────────────────────────────────────────

export async function handleBackToConcepts(ctx: BotContext) {
  await ctx.answerCallbackQuery();

  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  const artifact = await getLatestArtifact(projectId, "concept_direction");
  const conceptsText = (artifact?.data as Record<string, string> | null)?.concepts;

  if (!conceptsText) {
    await ctx.reply("Концепции не найдены. Запускаю генерацию заново...");
    await runConceptDirection(ctx);
    return;
  }

  ctx.session.module_state = artifact!.id;

  await sendConcepts(ctx, conceptsText);
  await ctx.reply("Выберите действие:", { reply_markup: conceptsKeyboard() });
}
