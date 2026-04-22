import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { generateWithClaude, REVISION_SYSTEM_PREFIX } from "../ai/gateway";
import { getActiveBrief } from "../db/briefs";
import { saveArtifact, getLatestArtifact, getApprovedArtifact, approveArtifact } from "../db/artifacts";
import { getLatestModuleRun } from "../db/moduleRuns";
import { updateCurrentModule } from "../db/projects";
import { sendLongMessage } from "../utils/telegram";
import { sendNextStep } from "../utils/nextStep";
import { getStyleGuide } from "../prompts/styleGuide";
import { logger } from "../config/logger";


const log = logger.child({ mod: "conceptDirection" });
const MODULE_NUM = 4;

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Ты — креативный директор брендинговой студии.

ВАЖНО: Тебе предоставлены утверждённые результаты предыдущих этапов (Brand DNA, нейминг, вербальная система). НЕ пересоздавай их. Используй КАК ЕСТЬ как основу.

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
  const dna =
    (await getApprovedArtifact(projectId, "brand_dna")) ??
    (await getLatestArtifact(projectId, "brand_dna"));
  const verbal =
    (await getApprovedArtifact(projectId, "verbal_system")) ??
    (await getLatestArtifact(projectId, "verbal_system"));

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
  // Handle both "🎨 КОНЦЕПЦИЯ" and "🎨 **КОНЦЕПЦИЯ" (Claude sometimes adds bold markers)
  const parts = text.split(/(?=🎨\s*\*{0,2}\s*КОНЦЕПЦИЯ)/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

// ── Keyboards ─────────────────────────────────────────────────────────────────

function conceptsKeyboard() {
  return new InlineKeyboard()
    .text("⭐ Выбрать концепцию", "concept:select")
    .row()
    .text("🔄 Другие направления", "concept:more")
    .text("✏️ Доработать", "concept:revise")
    .row()
    .text("↩️ К неймингу", "goto:3")
    .text("📊 Статус", "nav:status");
}

function selectedConceptKeyboard(artifactId: string) {
  return new InlineKeyboard()
    .text("✅ Одобрить", `concept:approve:${artifactId}`)
    .text("✏️ Доработать", `concept:revise_selected:${artifactId}`)
    .row()
    .text("↩️ Назад к концепциям", "concept:back")
    .text("📊 Статус", "nav:status");
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
  userMessage: string,
  systemPrefix = ""
): Promise<{ text: string; artifactId: string }> {
  const text = await generateWithClaude(systemPrefix + SYSTEM_PROMPT + "\n\n" + await getStyleGuide(), userMessage, {
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
  log.info("runConceptDirection called");
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  try {
    await ctx.reply("🎨 Запускаю модуль Concept Direction... Разрабатываю концепции...");
    await ctx.api.sendChatAction(ctx.chat!.id, "typing");
    await ctx.reply("💭 Думаю...");

    const input = await buildInput(projectId);
    log.info("buildInput OK, generating...");
    const { text, artifactId } = await generate(projectId, input);
    log.info({ artifactId }, "generate OK, artifactId:");

    await updateCurrentModule(projectId, MODULE_NUM);
    ctx.session.current_module = MODULE_NUM;
    ctx.session.module_state = artifactId;
    ctx.session.awaiting_input = null;

    await sendConcepts(ctx, text);
    await ctx.reply("Выберите действие:", { reply_markup: conceptsKeyboard() });
  } catch (error) {
    log.error({ err: (error as Error).message }, "runConceptDirection:");
    throw error;
  }
}

// ── More ──────────────────────────────────────────────────────────────────────

export async function handleConceptMore(ctx: BotContext) {
  log.info("handleConceptMore called");
  await ctx.answerCallbackQuery();
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  try {
    await ctx.reply("🔄 Генерирую новые концепции...");
    await ctx.api.sendChatAction(ctx.chat!.id, "typing");
    await ctx.reply("💭 Думаю...");

    const input = await buildInput(projectId);
    const existing = await getLatestArtifact(projectId, "concept_direction");
    const prevConcepts = (existing?.data as Record<string, string> | null)?.concepts ?? "";

    const { text, artifactId } = await generate(
      projectId,
      `${input}\n\nПредыдущие концепции (не повторяй):\n${prevConcepts}`
    );
    log.info({ artifactId }, "handleConceptMore generated, artifactId:");

    ctx.session.module_state = artifactId;

    await sendConcepts(ctx, text);
    await ctx.reply("Выберите действие:", { reply_markup: conceptsKeyboard() });
  } catch (error) {
    log.error({ err: (error as Error).message }, "handleConceptMore:");
    throw error;
  }
}

// ── Revise all ────────────────────────────────────────────────────────────────

export async function handleConceptRevise(ctx: BotContext) {
  log.info("handleConceptRevise called");
  await ctx.answerCallbackQuery();
  ctx.session.awaiting_input = "concept_revision";
  await ctx.reply("Что хотите изменить? Укажите пожелания по направлениям, стилю или акцентам.");
}

export async function handleConceptRevisionInput(ctx: BotContext, comment: string) {
  log.info({ comment }, "handleConceptRevisionInput called, comment:");
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  try {
    await ctx.api.sendChatAction(ctx.chat!.id, "typing");
    await ctx.reply("💭 Думаю...");

    const input = await buildInput(projectId);
    const existing = await getLatestArtifact(projectId, "concept_direction");
    const prevConcepts = (existing?.data as Record<string, string> | null)?.concepts ?? "";

    const { text, artifactId } = await generate(
      projectId,
      `Текущий результат:\n${prevConcepts}\n\nКомментарий клиента:\n${comment}\n\nОбнови концепции с учётом комментария. Сохрани всё что не было критиковано.`,
      REVISION_SYSTEM_PREFIX
    );
    log.info({ artifactId }, "handleConceptRevisionInput generated, artifactId:");

    ctx.session.module_state = artifactId;
    ctx.session.awaiting_input = null;

    await sendConcepts(ctx, text);
    await ctx.reply("Выберите действие:", { reply_markup: conceptsKeyboard() });
  } catch (error) {
    log.error({ err: (error as Error).message }, "handleConceptRevisionInput:");
    throw error;
  }
}

// ── Select ────────────────────────────────────────────────────────────────────

export async function handleConceptSelect(ctx: BotContext) {
  log.info("handleConceptSelect called");
  await ctx.answerCallbackQuery();
  ctx.session.awaiting_input = "concept_select";
  await ctx.reply(
    "Напишите номер понравившейся концепции.\n\nНапример: «1» или «Концепция 3»"
  );
}

export async function handleConceptSelectInput(ctx: BotContext, selection: string) {
  log.info({ selection }, "handleConceptSelectInput called, selection:");
  ctx.session.pending_selection = selection;
  ctx.session.awaiting_input = null;

  const kb = new InlineKeyboard()
    .text("✅ Подтвердить", "concept_proceed")
    .text("↩️ Вернуться к концепциям", "concept:back");

  await ctx.reply(
    `Отличный выбор! Подтверждаем концепцию *«${selection}»*?`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
}

export async function handleConceptProceed(ctx: BotContext) {
  await ctx.answerCallbackQuery();
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  const selection = ctx.session.pending_selection;
  if (!selection) {
    await ctx.reply(
      "Концепция не выбрана. Нажмите «⭐ Выбрать концепцию» и укажите номер.",
      { reply_markup: conceptsKeyboard() }
    );
    return;
  }
  ctx.session.pending_selection = null;

  log.info({ selection }, "handleConceptProceed: selection:");

  try {
    const existing = await getLatestArtifact(projectId, "concept_direction");
    console.log("[CONCEPT] existing artifact:", existing?.id, "stage:", (existing?.data as Record<string, string> | null)?.stage);

    const allConcepts = (existing?.data as Record<string, string> | null)?.concepts ?? "";
    console.log("[CONCEPT] allConcepts length:", allConcepts.length);

    const concepts = parseConcepts(allConcepts);
    console.log("[CONCEPT] parsed concepts count:", concepts.length);

    const num = parseInt(selection.replace(/\D/g, ""), 10);
    log.info({ num }, "parsed num:");

    const selectedText =
      !isNaN(num) && concepts[num - 1]
        ? concepts[num - 1]
        : concepts.find((c) => c.toLowerCase().includes(selection.toLowerCase())) ??
          allConcepts;

    console.log("[CONCEPT] selectedText length:", selectedText.length, "preview:", selectedText.slice(0, 80));

    const run = await getLatestModuleRun(projectId, MODULE_NUM);
    console.log("[CONCEPT] moduleRun:", run?.id);
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
    console.log("[CONCEPT] saved artifact:", artifact.id);

    ctx.session.module_state = artifact.id;

    await sendLongMessage(ctx, `Выбрана концепция:\n\n${selectedText}`, { parse_mode: undefined });
    await ctx.reply("Что делаем с концепцией?", {
      reply_markup: selectedConceptKeyboard(artifact.id),
    });
    log.info("handleConceptProceed: reply sent with keyboard");
  } catch (error) {
    log.error({ err: (error as Error).message }, "handleConceptProceed:");
    throw error;
  }
}

// ── Approve ───────────────────────────────────────────────────────────────────

export async function handleConceptApprove(ctx: BotContext, artifactId: string) {
  log.info({ artifactId }, "handleConceptApprove called, artifactId:");
  await ctx.answerCallbackQuery();

  try {
    await approveArtifact(artifactId);

    const projectId = ctx.session.active_project_id;
    if (!projectId) return;

    await updateCurrentModule(projectId, 5);
    ctx.session.current_module = 5;
    ctx.session.module_state = null;

    const { showOrRunModule } = await import("./moduleNav");
    await showOrRunModule(ctx, 5);
    log.info("handleConceptApprove: approved, moved to module 5");
  } catch (error) {
    log.error({ err: (error as Error).message }, "handleConceptApprove:");
    throw error;
  }
}

// ── Revise selected ───────────────────────────────────────────────────────────

export async function handleConceptReviseSelected(ctx: BotContext, artifactId: string) {
  log.info({ artifactId }, "handleConceptReviseSelected called, artifactId:");
  await ctx.answerCallbackQuery();
  ctx.session.awaiting_input = "concept_selected_revision";
  ctx.session.module_state = artifactId;
  await ctx.reply("Что хотите изменить в выбранной концепции?");
}

export async function handleConceptSelectedRevisionInput(
  ctx: BotContext,
  comment: string
) {
  log.info({ comment }, "handleConceptSelectedRevisionInput called, comment:");
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  try {
    await ctx.api.sendChatAction(ctx.chat!.id, "typing");
    await ctx.reply("💭 Думаю...");

    const existing = await getLatestArtifact(projectId, "concept_direction");
    const data = (existing?.data as Record<string, string>) ?? {};
    const prevConcept = data.selectedConcept ?? "";
    console.log("[CONCEPT] prevConcept length:", prevConcept.length);

    const input = await buildInput(projectId);

    const revisedText = await generateWithClaude(
      REVISION_SYSTEM_PREFIX + SYSTEM_PROMPT + "\n\n" + await getStyleGuide(),
      `Текущий результат:\n${prevConcept}\n\nКомментарий клиента:\n${comment}\n\nОбнови концепцию с учётом комментария. Сохрани всё что не было критиковано.`,
      { projectId, moduleNum: MODULE_NUM, maxTokens: 2000 }
    );
    console.log("[CONCEPT] revisedText length:", revisedText.length);

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
    console.log("[CONCEPT] handleConceptSelectedRevisionInput: saved artifact:", artifact.id);

    ctx.session.awaiting_input = null;
    ctx.session.module_state = artifact.id;

    await sendLongMessage(ctx, `Концепция (обновлено):\n\n${revisedText}`, { parse_mode: undefined });
    await ctx.reply("Что делаем с концепцией?", {
      reply_markup: selectedConceptKeyboard(artifact.id),
    });
  } catch (error) {
    log.error({ err: (error as Error).message }, "handleConceptSelectedRevisionInput:");
    throw error;
  }
}

// ── Back ──────────────────────────────────────────────────────────────────────

export async function handleBackToConcepts(ctx: BotContext) {
  log.info("handleBackToConcepts called");
  await ctx.answerCallbackQuery();

  try {
    const projectId = ctx.session.active_project_id;
    if (!projectId) return;

    const artifact = await getLatestArtifact(projectId, "concept_direction");
    const conceptsText = (artifact?.data as Record<string, string> | null)?.concepts;
    console.log("[CONCEPT] handleBackToConcepts: conceptsText length:", conceptsText?.length);

    if (!conceptsText) {
      await ctx.reply("Концепции не найдены. Запускаю генерацию заново...");
      await runConceptDirection(ctx);
      return;
    }

    ctx.session.module_state = artifact!.id;

    await sendConcepts(ctx, conceptsText);
    await ctx.reply("Выберите действие:", { reply_markup: conceptsKeyboard() });
  } catch (error) {
    log.error({ err: (error as Error).message }, "handleBackToConcepts:");
    throw error;
  }
}
