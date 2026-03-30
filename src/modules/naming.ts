import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { generateWithClaude } from "../ai/gateway";
import { getActiveBrief } from "../db/briefs";
import { saveArtifact, getLatestArtifact, approveArtifact } from "../db/artifacts";
import { getLatestModuleRun } from "../db/moduleRuns";
import { updateCurrentModule } from "../db/projects";
import { sendLongMessage } from "../utils/telegram";
import { sendNextStep } from "../utils/nextStep";

const MODULE_NUM = 3;

// ── System prompts ────────────────────────────────────────────────────────────

const NAMING_SYSTEM_PROMPT = `Ты — эксперт по неймингу брендов.
На основе брифа и стратегической платформы бренда предложи названия.

Создай 3–4 naming territory (направления нейминга).
В каждом направлении — 3–4 варианта названий.

Для каждого названия укажи:
- Само название
- Тип (описательное / метафора / неологизм / аббревиатура / имя)
- Логика: почему это название работает для этого бренда
- Язык: на каком языке основано

Формат:

🏷 НАПРАВЛЕНИЕ 1: [название территории]
[описание логики направления]

  1. **[Название]** — [тип]
     💡 [логика]

  2. **[Название]** — [тип]
     💡 [логика]

🏷 НАПРАВЛЕНИЕ 2: ...`;

const VERBAL_SYSTEM_PROMPT = `Ты — эксперт по вербальным коммуникациям бренда.
На основе брифа, Brand DNA и выбранного названия создай вербальную систему бренда.

Ответь в формате:

📝 ДЕСКРИПТОРЫ
[3–5 кратких описаний бренда для разных контекстов]

💬 СЛОГАНЫ
[5 вариантов слоганов с пояснением логики каждого]

🗣 TONE OF VOICE GUIDE
[Подробное руководство: 4–5 принципов голоса с примерами]

✍️ ПРИМЕРЫ ТЕКСТОВ
Приветствие (онбординг):
[текст]

Описание продукта:
[текст]

Пост для соцсетей:
[текст]

Email-рассылка:
[текст]`;

// ── Context helpers ───────────────────────────────────────────────────────────

async function buildNamingInput(projectId: string): Promise<string> {
  const brief = await getActiveBrief(projectId);
  const dnaArtifact = await getLatestArtifact(projectId, "brand_dna");

  const briefText = brief?.summary ?? "Бриф не найден";
  const dnaText = (dnaArtifact?.data as Record<string, string> | null)?.text ?? "Brand DNA не найдена";

  return `БРИФ ПРОЕКТА:\n${briefText}\n\nBRAND DNA:\n${dnaText}`;
}

async function buildVerbalInput(
  projectId: string,
  selection: string
): Promise<string> {
  const base = await buildNamingInput(projectId);
  const namingArtifact = await getLatestArtifact(projectId, "verbal_system");
  const namingText =
    (namingArtifact?.data as Record<string, string> | null)?.naming ?? "";

  return (
    `${base}\n\n` +
    (namingText ? `ВАРИАНТЫ НЕЙМИНГА:\n${namingText}\n\n` : "") +
    `ВЫБРАННОЕ НАПРАВЛЕНИЕ / НАЗВАНИЕ:\n${selection}`
  );
}

// ── Keyboards ─────────────────────────────────────────────────────────────────

function namingKeyboard() {
  return new InlineKeyboard()
    .text("⭐ Выбрать направление", "naming:select")
    .row()
    .text("🔄 Сгенерировать ещё", "naming:more")
    .text("✏️ Доработать", "naming:revise");
}

function verbalKeyboard(artifactId: string) {
  return new InlineKeyboard()
    .text("✅ Одобрить", `verbal:approve:${artifactId}`)
    .text("✏️ Доработать", `verbal:revise:${artifactId}`)
    .row()
    .text("↩️ Назад к неймингу", "verbal:back_to_naming");
}

// ── Stage 1: Naming ───────────────────────────────────────────────────────────

export async function runNaming(ctx: BotContext) {
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await ctx.reply("🏷 Запускаю модуль Naming... Генерирую варианты названий...");
  await ctx.api.sendChatAction(ctx.chat!.id, "typing");

  const input = await buildNamingInput(projectId);
  const namingText = await generateWithClaude(NAMING_SYSTEM_PROMPT, input, {
    projectId,
    moduleNum: MODULE_NUM,
    maxTokens: 3000,
  });

  const run = await getLatestModuleRun(projectId, MODULE_NUM);
  if (!run) throw new Error("Module run not saved");

  const existing = await getLatestArtifact(projectId, "verbal_system");
  const artifact = await saveArtifact({
    moduleRunId: run.id,
    projectId,
    type: "verbal_system",
    name: "Naming",
    data: { stage: "naming", naming: namingText },
    version: existing ? existing.version + 1 : 1,
  });

  ctx.session.current_module = MODULE_NUM;
  ctx.session.module_state = artifact.id;
  ctx.session.awaiting_input = null;

  await sendLongMessage(ctx, `*🏷 Варианты нейминга*\n\n${namingText}`);
  await ctx.reply("Выберите действие:", { reply_markup: namingKeyboard() });
}

export async function handleNamingMore(ctx: BotContext) {
  await ctx.answerCallbackQuery();
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await ctx.reply("🔄 Генерирую новые варианты...");
  await ctx.api.sendChatAction(ctx.chat!.id, "typing");

  const input = await buildNamingInput(projectId);
  const existing = await getLatestArtifact(projectId, "verbal_system");
  const prevNaming = (existing?.data as Record<string, string> | null)?.naming ?? "";

  const namingText = await generateWithClaude(
    NAMING_SYSTEM_PROMPT,
    `${input}\n\nПредыдущие варианты (не повторяй их):\n${prevNaming}`,
    { projectId, moduleNum: MODULE_NUM, maxTokens: 3000 }
  );

  const run = await getLatestModuleRun(projectId, MODULE_NUM);
  if (!run) throw new Error("Module run not saved");

  const artifact = await saveArtifact({
    moduleRunId: run.id,
    projectId,
    type: "verbal_system",
    name: "Naming",
    data: { stage: "naming", naming: namingText },
    version: existing ? existing.version + 1 : 1,
  });

  ctx.session.module_state = artifact.id;

  await sendLongMessage(ctx, `*🏷 Новые варианты нейминга*\n\n${namingText}`);
  await ctx.reply("Выберите действие:", { reply_markup: namingKeyboard() });
}

export async function handleNamingRevise(ctx: BotContext) {
  await ctx.answerCallbackQuery();
  ctx.session.awaiting_input = "naming_revision";
  await ctx.reply(
    "Что хотите изменить? Укажите пожелания по направлениям, языку или стилю нейминга."
  );
}

export async function handleNamingRevisionInput(ctx: BotContext, comment: string) {
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await ctx.api.sendChatAction(ctx.chat!.id, "typing");

  const input = await buildNamingInput(projectId);
  const existing = await getLatestArtifact(projectId, "verbal_system");
  const prevNaming = (existing?.data as Record<string, string> | null)?.naming ?? "";

  const namingText = await generateWithClaude(
    NAMING_SYSTEM_PROMPT,
    `${input}\n\nПредыдущие варианты:\n${prevNaming}\n\nКомментарий:\n${comment}\n\nПерегенерируй с учётом комментария.`,
    { projectId, moduleNum: MODULE_NUM, maxTokens: 3000 }
  );

  const run = await getLatestModuleRun(projectId, MODULE_NUM);
  if (!run) throw new Error("Module run not saved");

  const artifact = await saveArtifact({
    moduleRunId: run.id,
    projectId,
    type: "verbal_system",
    name: "Naming",
    data: { stage: "naming", naming: namingText },
    version: existing ? existing.version + 1 : 1,
  });

  ctx.session.module_state = artifact.id;
  ctx.session.awaiting_input = null;

  await sendLongMessage(ctx, `*🏷 Нейминг (обновлено)*\n\n${namingText}`);
  await ctx.reply("Выберите действие:", { reply_markup: namingKeyboard() });
}

export async function handleNamingSelect(ctx: BotContext) {
  await ctx.answerCallbackQuery();
  ctx.session.awaiting_input = "naming_select";
  await ctx.reply(
    "Укажите номер направления или конкретное название, которое вам нравится.\n\n" +
    "_Например: «Направление 2» или «Lumina»_",
    { parse_mode: "Markdown" }
  );
}

// ── Stage 2: Verbal System ────────────────────────────────────────────────────

export async function handleNamingSelectInput(ctx: BotContext, selection: string) {
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  ctx.session.awaiting_input = null;

  await ctx.reply(`Отличный выбор! Разрабатываю вербальную систему для «${selection}»...`);
  await ctx.api.sendChatAction(ctx.chat!.id, "typing");

  const input = await buildVerbalInput(projectId, selection);
  const verbalText = await generateWithClaude(VERBAL_SYSTEM_PROMPT, input, {
    projectId,
    moduleNum: MODULE_NUM,
    maxTokens: 3500,
  });

  const run = await getLatestModuleRun(projectId, MODULE_NUM);
  if (!run) throw new Error("Module run not saved");

  const existing = await getLatestArtifact(projectId, "verbal_system");
  const namingText =
    (existing?.data as Record<string, string> | null)?.naming ?? "";

  const artifact = await saveArtifact({
    moduleRunId: run.id,
    projectId,
    type: "verbal_system",
    name: `Verbal System — ${selection}`,
    data: { stage: "complete", naming: namingText, selectedName: selection, verbal: verbalText },
    version: existing ? existing.version + 1 : 1,
  });

  ctx.session.module_state = artifact.id;

  await sendLongMessage(ctx, `*🗣 Вербальная система — ${selection}*\n\n${verbalText}`);
  await ctx.reply("Что скажете?", { reply_markup: verbalKeyboard(artifact.id) });
}

export async function handleVerbalApprove(ctx: BotContext, artifactId: string) {
  await ctx.answerCallbackQuery();

  await approveArtifact(artifactId);

  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await updateCurrentModule(projectId, 4);
  ctx.session.current_module = 4;
  ctx.session.module_state = null;

  await sendNextStep(ctx, projectId, "✅ *Вербальная система одобрена!*");
}

export async function handleVerbalRevise(ctx: BotContext, artifactId: string) {
  await ctx.answerCallbackQuery();
  ctx.session.awaiting_input = "verbal_revision";
  ctx.session.module_state = artifactId;
  await ctx.reply("Что хотите изменить в вербальной системе?");
}

export async function handleVerbalRevisionInput(ctx: BotContext, comment: string) {
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await ctx.api.sendChatAction(ctx.chat!.id, "typing");

  const existing = await getLatestArtifact(projectId, "verbal_system");
  const data = (existing?.data as Record<string, string>) ?? {};
  const selection = data.selectedName ?? "";
  const prevVerbal = data.verbal ?? "";

  const input = await buildVerbalInput(projectId, selection);
  const verbalText = await generateWithClaude(
    VERBAL_SYSTEM_PROMPT,
    `${input}\n\nПредыдущая версия вербальной системы:\n${prevVerbal}\n\nКомментарий:\n${comment}\n\nПерегенерируй с учётом комментария.`,
    { projectId, moduleNum: MODULE_NUM, maxTokens: 3500 }
  );

  const run = await getLatestModuleRun(projectId, MODULE_NUM);
  if (!run) throw new Error("Module run not saved");

  const artifact = await saveArtifact({
    moduleRunId: run.id,
    projectId,
    type: "verbal_system",
    name: `Verbal System — ${selection}`,
    data: { stage: "complete", naming: data.naming ?? "", selectedName: selection, verbal: verbalText },
    version: existing ? existing.version + 1 : 1,
  });

  ctx.session.awaiting_input = null;
  ctx.session.module_state = artifact.id;

  await sendLongMessage(ctx, `*🗣 Вербальная система (обновлено)*\n\n${verbalText}`);
  await ctx.reply("Что скажете?", { reply_markup: verbalKeyboard(artifact.id) });
}

export async function handleBackToNaming(ctx: BotContext) {
  await ctx.answerCallbackQuery();

  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  const artifact = await getLatestArtifact(projectId, "verbal_system");
  const namingText =
    (artifact?.data as Record<string, string> | null)?.naming;

  if (!namingText) {
    await ctx.reply("Нейминг не найден. Запускаю генерацию заново...");
    await runNaming(ctx);
    return;
  }

  ctx.session.module_state = artifact!.id;

  await sendLongMessage(ctx, `*🏷 Варианты нейминга*\n\n${namingText}`);
  await ctx.reply("Выберите действие:", { reply_markup: namingKeyboard() });
}
