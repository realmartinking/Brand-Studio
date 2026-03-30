import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { generateWithClaude } from "../ai/gateway";
import { getActiveBrief } from "../db/briefs";
import { saveArtifact, getLatestArtifact, approveArtifact } from "../db/artifacts";
import { getLatestModuleRun } from "../db/moduleRuns";
import { updateCurrentModule } from "../db/projects";
import { sendLongMessage } from "../utils/telegram";
import { sendNextStep } from "../utils/nextStep";

const MODULE_NUM = 5;

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Ты — art director брендинговой студии.
На основе стратегии, вербальной системы и выбранной концепции
опиши визуальную идентичность бренда.

🎨 ЦВЕТОВАЯ ПАЛИТРА
- Primary: [цвет + HEX + ассоциация]
- Secondary: [цвет + HEX + ассоциация]
- Accent: [цвет + HEX + ассоциация]
- Neutrals: [описание нейтральных тонов]
- Логика палитры: [почему эти цвета]

🔤 ТИПОГРАФИКА
- Заголовки: [рекомендация шрифта + характер]
- Тексты: [рекомендация шрифта + характер]
- Акценты: [если нужен третий шрифт]
- Принцип: [как типографика поддерживает характер бренда]

📐 КОМПОЗИЦИЯ И СТИЛЬ
- Графический язык: [описание стиля]
- Принципы композиции: [как строятся макеты]
- Паттерны и текстуры: [если применимо]
- Фотостиль: [какие фотографии подходят бренду]

🖼 KEY VISUALS
[Описание 3 ключевых визуальных образов бренда]

🤖 ПРОМПТЫ ДЛЯ AI-ГЕНЕРАЦИИ
Создай 3 детальных промпта для генерации изображений (DALL-E / Midjourney).
Каждый промпт — конкретное описание key visual.`;

// ── Input builder ─────────────────────────────────────────────────────────────

async function buildInput(projectId: string): Promise<string> {
  const brief = await getActiveBrief(projectId);
  const dna = await getLatestArtifact(projectId, "brand_dna");
  const verbal = await getLatestArtifact(projectId, "verbal_system");
  const concept = await getLatestArtifact(projectId, "concept_direction");

  const briefText = brief?.summary ?? "Бриф не найден";
  const dnaText = (dna?.data as Record<string, string> | null)?.text ?? "Brand DNA не найдена";
  const verbalData = verbal?.data as Record<string, string> | null;
  const verbalText = verbalData?.verbal ?? verbalData?.naming ?? "Вербальная система не найдена";
  const selectedName = verbalData?.selectedName ?? "";
  const conceptData = concept?.data as Record<string, string> | null;
  const conceptText = conceptData?.selectedConcept ?? conceptData?.concepts ?? "Концепция не найдена";

  return (
    `БРИФ:\n${briefText}\n\n` +
    `BRAND DNA:\n${dnaText}\n\n` +
    `НАЗВАНИЕ БРЕНДА: ${selectedName}\n\n` +
    `ВЕРБАЛЬНАЯ СИСТЕМА:\n${verbalText}\n\n` +
    `ВЫБРАННАЯ КОНЦЕПЦИЯ:\n${conceptText}`
  );
}

// ── Keyboard ──────────────────────────────────────────────────────────────────

function visualKeyboard(artifactId: string) {
  return new InlineKeyboard()
    .text("✅ Одобрить", `visual:approve:${artifactId}`)
    .text("✏️ Доработать", `visual:revise:${artifactId}`)
    .row()
    .text("↩️ Назад к концепциям", "visual:back_to_concepts");
}

// ── Generate helper ───────────────────────────────────────────────────────────

async function generate(projectId: string, userMessage: string) {
  const text = await generateWithClaude(SYSTEM_PROMPT, userMessage, {
    projectId,
    moduleNum: MODULE_NUM,
    maxTokens: 3500,
  });

  const run = await getLatestModuleRun(projectId, MODULE_NUM);
  if (!run) throw new Error("Module run not saved");

  const existing = await getLatestArtifact(projectId, "visual_identity");
  const artifact = await saveArtifact({
    moduleRunId: run.id,
    projectId,
    type: "visual_identity",
    name: "Visual Identity",
    data: { text },
    version: existing ? existing.version + 1 : 1,
  });

  return { text, artifact };
}

// ── Run ───────────────────────────────────────────────────────────────────────

export async function runVisualIdentity(ctx: BotContext) {
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await ctx.reply("🎨 Запускаю модуль Visual Identity... Формирую визуальный язык бренда...");
  await ctx.api.sendChatAction(ctx.chat!.id, "typing");

  const input = await buildInput(projectId);
  const { text, artifact } = await generate(projectId, input);

  ctx.session.current_module = MODULE_NUM;
  ctx.session.module_state = artifact.id;
  ctx.session.awaiting_input = null;

  await sendLongMessage(ctx, `*🎨 Visual Identity*\n\n${text}`);
  await ctx.reply("Что скажете?", { reply_markup: visualKeyboard(artifact.id) });
}

// ── Approve ───────────────────────────────────────────────────────────────────

export async function handleVisualApprove(ctx: BotContext, artifactId: string) {
  await ctx.answerCallbackQuery();

  await approveArtifact(artifactId);

  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await updateCurrentModule(projectId, 6);
  ctx.session.current_module = 6;
  ctx.session.module_state = null;

  await sendNextStep(ctx, projectId, "✅ *Visual Identity одобрена!* Последний шаг — сборка Brand Book.");
}

// ── Revise ────────────────────────────────────────────────────────────────────

export async function handleVisualRevise(ctx: BotContext, artifactId: string) {
  await ctx.answerCallbackQuery();
  ctx.session.awaiting_input = "visual_revision";
  ctx.session.module_state = artifactId;
  await ctx.reply(
    "Что хотите изменить? Укажите пожелания по палитре, типографике, стилю или промптам."
  );
}

export async function handleVisualRevisionInput(ctx: BotContext, comment: string) {
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await ctx.api.sendChatAction(ctx.chat!.id, "typing");

  const input = await buildInput(projectId);
  const existing = await getLatestArtifact(projectId, "visual_identity");
  const prevText = (existing?.data as Record<string, string> | null)?.text ?? "";

  const { text, artifact } = await generate(
    projectId,
    `${input}\n\nПредыдущая версия Visual Identity:\n${prevText}\n\nКомментарий:\n${comment}\n\nПерегенерируй с учётом комментария, сохрани структуру.`
  );

  ctx.session.awaiting_input = null;
  ctx.session.module_state = artifact.id;

  await sendLongMessage(ctx, `*🎨 Visual Identity (обновлено)*\n\n${text}`);
  await ctx.reply("Что скажете?", { reply_markup: visualKeyboard(artifact.id) });
}

// ── Back ──────────────────────────────────────────────────────────────────────

export async function handleBackToConcepts(ctx: BotContext) {
  await ctx.answerCallbackQuery();

  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  const { runConceptDirection, handleBackToConcepts: backToConcepts } = await import(
    "./conceptDirection"
  );

  const artifact = await getLatestArtifact(projectId, "concept_direction");
  if (!artifact) {
    await ctx.reply("Концепции не найдены. Запускаю генерацию...");
    await runConceptDirection(ctx);
    return;
  }

  await backToConcepts(ctx);
}
