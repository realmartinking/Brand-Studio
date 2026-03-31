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
  console.log("[CONCEPT] runConceptDirection called");
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  try {
    await ctx.reply("🎨 Запускаю модуль Concept Direction... Разрабатываю концепции...");
    await ctx.api.sendChatAction(ctx.chat!.id, "typing");

    const input = await buildInput(projectId);
    console.log("[CONCEPT] buildInput OK, generating...");
    const { text, artifactId } = await generate(projectId, input);
    console.log("[CONCEPT] generate OK, artifactId:", artifactId);

    ctx.session.current_module = MODULE_NUM;
    ctx.session.module_state = artifactId;
    ctx.session.awaiting_input = null;

    await sendConcepts(ctx, text);
    await ctx.reply("Выберите действие:", { reply_markup: conceptsKeyboard() });
  } catch (error) {
    console.error("[CONCEPT ERROR] runConceptDirection:", error);
    throw error;
  }
}

// ── More ──────────────────────────────────────────────────────────────────────

export async function handleConceptMore(ctx: BotContext) {
  console.log("[CONCEPT] handleConceptMore called");
  await ctx.answerCallbackQuery();
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  try {
    await ctx.reply("🔄 Генерирую новые концепции...");
    await ctx.api.sendChatAction(ctx.chat!.id, "typing");

    const input = await buildInput(projectId);
    const existing = await getLatestArtifact(projectId, "concept_direction");
    const prevConcepts = (existing?.data as Record<string, string> | null)?.concepts ?? "";

    const { text, artifactId } = await generate(
      projectId,
      `${input}\n\nПредыдущие концепции (не повторяй):\n${prevConcepts}`
    );
    console.log("[CONCEPT] handleConceptMore generated, artifactId:", artifactId);

    ctx.session.module_state = artifactId;

    await sendConcepts(ctx, text);
    await ctx.reply("Выберите действие:", { reply_markup: conceptsKeyboard() });
  } catch (error) {
    console.error("[CONCEPT ERROR] handleConceptMore:", error);
    throw error;
  }
}

// ── Revise all ────────────────────────────────────────────────────────────────

export async function handleConceptRevise(ctx: BotContext) {
  console.log("[CONCEPT] handleConceptRevise called");
  await ctx.answerCallbackQuery();
  ctx.session.awaiting_input = "concept_revision";
  await ctx.reply("Что хотите изменить? Укажите пожелания по направлениям, стилю или акцентам.");
}

export async function handleConceptRevisionInput(ctx: BotContext, comment: string) {
  console.log("[CONCEPT] handleConceptRevisionInput called, comment:", comment);
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  try {
    await ctx.api.sendChatAction(ctx.chat!.id, "typing");

    const input = await buildInput(projectId);
    const existing = await getLatestArtifact(projectId, "concept_direction");
    const prevConcepts = (existing?.data as Record<string, string> | null)?.concepts ?? "";

    const { text, artifactId } = await generate(
      projectId,
      `${input}\n\nПредыдущие концепции:\n${prevConcepts}\n\nКомментарий:\n${comment}\n\nПерегенерируй с учётом комментария.`
    );
    console.log("[CONCEPT] handleConceptRevisionInput generated, artifactId:", artifactId);

    ctx.session.module_state = artifactId;
    ctx.session.awaiting_input = null;

    await sendConcepts(ctx, text);
    await ctx.reply("Выберите действие:", { reply_markup: conceptsKeyboard() });
  } catch (error) {
    console.error("[CONCEPT ERROR] handleConceptRevisionInput:", error);
    throw error;
  }
}

// ── Select ────────────────────────────────────────────────────────────────────

export async function handleConceptSelect(ctx: BotContext) {
  console.log("[CONCEPT] handleConceptSelect called");
  await ctx.answerCallbackQuery();
  ctx.session.awaiting_input = "concept_select";
  await ctx.reply(
    "Напишите номер понравившейся концепции.\n\nНапример: «1» или «Концепция 3»"
  );
}

export async function handleConceptSelectInput(ctx: BotContext, selection: string) {
  console.log("[CONCEPT] handleConceptSelectInput called, selection:", selection);
  const projectId = ctx.session.active_project_id;
  if (!projectId) {
    console.error("[CONCEPT ERROR] handleConceptSelectInput: no projectId in session");
    return;
  }

  try {
    ctx.session.awaiting_input = null;

    const existing = await getLatestArtifact(projectId, "concept_direction");
    console.log("[CONCEPT] existing artifact:", existing?.id, "stage:", (existing?.data as Record<string, string> | null)?.stage);

    const allConcepts = (existing?.data as Record<string, string> | null)?.concepts ?? "";
    console.log("[CONCEPT] allConcepts length:", allConcepts.length);

    // Parse the concept number from user input
    const concepts = parseConcepts(allConcepts);
    console.log("[CONCEPT] parsed concepts count:", concepts.length);

    const num = parseInt(selection.replace(/\D/g, ""), 10);
    console.log("[CONCEPT] parsed num:", num);

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

    // Send selected concept via sendLongMessage (respects 4096-char Telegram limit)
    await sendLongMessage(ctx, `Выбрана концепция:\n\n${selectedText}`, { parse_mode: undefined });
    // Send keyboard as a separate short message
    await ctx.reply("Что делаем с концепцией?", {
      reply_markup: selectedConceptKeyboard(artifact.id),
    });
    console.log("[CONCEPT] handleConceptSelectInput: reply sent with keyboard");
  } catch (error) {
    console.error("[CONCEPT ERROR] handleConceptSelectInput:", error);
    throw error;
  }
}

// ── Approve ───────────────────────────────────────────────────────────────────

export async function handleConceptApprove(ctx: BotContext, artifactId: string) {
  console.log("[CONCEPT] handleConceptApprove called, artifactId:", artifactId);
  await ctx.answerCallbackQuery();

  try {
    await approveArtifact(artifactId);

    const projectId = ctx.session.active_project_id;
    if (!projectId) return;

    await updateCurrentModule(projectId, 5);
    ctx.session.current_module = 5;
    ctx.session.module_state = null;

    await sendNextStep(ctx, projectId, "✅ Концептуальное направление одобрено!");
    console.log("[CONCEPT] handleConceptApprove: approved, moved to module 5");
  } catch (error) {
    console.error("[CONCEPT ERROR] handleConceptApprove:", error);
    throw error;
  }
}

// ── Revise selected ───────────────────────────────────────────────────────────

export async function handleConceptReviseSelected(ctx: BotContext, artifactId: string) {
  console.log("[CONCEPT] handleConceptReviseSelected called, artifactId:", artifactId);
  await ctx.answerCallbackQuery();
  ctx.session.awaiting_input = "concept_selected_revision";
  ctx.session.module_state = artifactId;
  await ctx.reply("Что хотите изменить в выбранной концепции?");
}

export async function handleConceptSelectedRevisionInput(
  ctx: BotContext,
  comment: string
) {
  console.log("[CONCEPT] handleConceptSelectedRevisionInput called, comment:", comment);
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  try {
    await ctx.api.sendChatAction(ctx.chat!.id, "typing");

    const existing = await getLatestArtifact(projectId, "concept_direction");
    const data = (existing?.data as Record<string, string>) ?? {};
    const prevConcept = data.selectedConcept ?? "";
    console.log("[CONCEPT] prevConcept length:", prevConcept.length);

    const input = await buildInput(projectId);

    const revisedText = await generateWithClaude(
      SYSTEM_PROMPT,
      `${input}\n\nВыбранная концепция для доработки:\n${prevConcept}\n\nКомментарий:\n${comment}\n\nПерегенерируй ТОЛЬКО эту концепцию с учётом комментария, сохрани формат.`,
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
    console.error("[CONCEPT ERROR] handleConceptSelectedRevisionInput:", error);
    throw error;
  }
}

// ── Back ──────────────────────────────────────────────────────────────────────

export async function handleBackToConcepts(ctx: BotContext) {
  console.log("[CONCEPT] handleBackToConcepts called");
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
    console.error("[CONCEPT ERROR] handleBackToConcepts:", error);
    throw error;
  }
}
