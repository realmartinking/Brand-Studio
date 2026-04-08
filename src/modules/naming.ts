import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { generateWithClaude, REVISION_SYSTEM_PREFIX } from "../ai/gateway";
import { getActiveBrief, getUploadedDocumentsContext } from "../db/briefs";
import { saveArtifact, getLatestArtifact, getApprovedArtifact, getAllArtifactsOfType, approveArtifact } from "../db/artifacts";
import { getLatestModuleRun } from "../db/moduleRuns";
import { updateCurrentModule } from "../db/projects";
import { sendLongMessage } from "../utils/telegram";
import { sendNextStep } from "../utils/nextStep";
import { getStyleGuide } from "../prompts/styleGuide";
import { getNamingSkill } from "../prompts/namingSkill";

const MODULE_NUM = 3;

// ── System prompts ────────────────────────────────────────────────────────────

const NAMING_SYSTEM_PROMPT = `ОБЯЗАТЕЛЬНО: Тебе предоставлены бриф и Brand DNA. Используй ИХ. Не проси клиента повторно описать бренд. Не задавай уточняющих вопросов — генерируй названия из того что есть.

Ты — нейминг-стратег уровня топовых креативных агентств (SmartHeart, Shuka, Suprematika).

ВАЖНО: Тебе предоставлена утверждённая бренд-платформа (Brand DNA). НЕ пересоздавай её, НЕ комментируй её. Используй КАК ЕСТЬ как основу для нейминга.

Твоя задача — создать названия, которые РАСКРЫВАЮТ БРЕНД через коммуникацию. Следуй методологии из <naming_methodology> максимально строго.

КЛЮЧЕВОЙ ПРИНЦИП: Лучший нейм — это слово, которое работает на нескольких смысловых уровнях и естественно встраивается в живую речь. НЕ предлагай прямолинейные составные слова (типа BrandMaker, SmartBuild). НЕ предлагай клише категории.

Создай 3–4 naming territory (направления).
В каждом направлении — 2–3 варианта названий.

Для КАЖДОГО названия обязательно:
- Название (в нужном написании)
- Фонетика — как произносится
- Семантика — откуда слово, корни, значения
- Почему работает — 1-2 предложения, как раскрывает суть бренда
- Коммуникации — 2-3 фразы/слогана где нейм играет
- Тест переписки — как звучит в SMS между друзьями (формат диалога)

Формат:

🏷 НАПРАВЛЕНИЕ 1: [название территории]
[логика направления — 1 предложение]

**[НАЗВАНИЕ]**
📖 Фонетика: [как читается]
🔍 Семантика: [происхождение, корни]
💡 Почему работает: [связь с брендом]
💬 Коммуникации:
— [фраза 1]
— [фраза 2]
📱 В переписке:
— [реплика друга]
— [ответ]

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

// ── Name extraction helper ────────────────────────────────────────────────────

/**
 * Strips common selection-intent prefixes so "Выбираю Kortex" → "Kortex".
 */
export function extractCleanName(text: string): string {
  const cleaned = text
    .replace(
      /^(выбираю|выбираем|хочу назвать|хочу|мне нравится|нравится|берём|возьмём|остановлюсь на|мой выбор|итого|финально|назовём|назвать|буду использовать|предлагаю|что если назвать|а что если|поставим|поставлю)\s+/i,
      ""
    )
    .replace(/^(choosing|i choose|let's go with|i like|how about)\s+/i, "")
    .replace(/^[«"']|[»"']$/g, "")
    .trim();
  return cleaned || text;
}

// ── Naming history helpers ────────────────────────────────────────────────────

function extractNamesFromText(text: string): string[] {
  const names: string[] = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim();
    if (
      name.length >= 2 &&
      name.length <= 40 &&
      !name.startsWith("НАПРАВЛЕНИЕ") &&
      !name.startsWith("Направление") &&
      !name.includes("ДЕСКРИПТОР") &&
      !name.includes("СЛОГАН")
    ) {
      names.push(name);
    }
  }
  return names;
}

async function getAllPreviousNames(projectId: string): Promise<string[]> {
  const allArtifacts = await getAllArtifactsOfType(projectId, "verbal_system");
  const allNames: string[] = [];
  for (const artifact of allArtifacts) {
    const data = artifact.data as Record<string, string> | null;
    const naming = data?.naming ?? "";
    if (naming) allNames.push(...extractNamesFromText(naming));
  }
  return [...new Set(allNames)];
}

function buildNamingSystemPrompt(previousNames: string[]): string {
  let prompt = NAMING_SYSTEM_PROMPT;
  if (previousNames.length > 0) {
    prompt += `\n\n---\nКРИТИЧЕСКОЕ ПРАВИЛО — ЗАПРЕТ ПОВТОРОВ:\nЭти названия УЖЕ были предложены. НЕ ПОВТОРЯЙ ни одно из них и их производные:\n`;
    prompt += previousNames.join(", ");
    prompt += `\nПредложи ПОЛНОСТЬЮ НОВЫЕ варианты. Смени типологию, язык, ассоциативный подход.`;
  }
  return prompt;
}

// ── Context helpers ───────────────────────────────────────────────────────────

async function buildNamingInput(projectId: string): Promise<string> {
  const brief = await getActiveBrief(projectId);
  const dnaArtifact =
    (await getApprovedArtifact(projectId, "brand_dna")) ??
    (await getLatestArtifact(projectId, "brand_dna"));

  // Brief: попробовать summary, потом uploaded_documents, потом dialog
  let briefText = brief?.summary ?? "";
  if (!briefText) {
    briefText = await getUploadedDocumentsContext(projectId) || "";
  }
  if (!briefText) {
    const data = (brief?.data as Record<string, unknown>) ?? {};
    const dialog = (data.dialog as Array<{ role: string; content: string }>) ?? [];
    briefText = dialog.map((m) => `${m.role === "user" ? "Клиент" : "Стратег"}: ${m.content}`).join("\n\n");
  }
  if (!briefText) briefText = "Бриф не найден";

  const dnaText = (dnaArtifact?.data as Record<string, string> | null)?.text ?? "Brand DNA не найдена";

  console.log("[naming] Brand DNA found:", dnaText.substring(0, 100));
  console.log("[naming] Brief found:", briefText.substring(0, 100));

  return `БРИФ ПРОЕКТА:\n${briefText}\n\n---\nУТВЕРЖДЁННАЯ BRAND DNA (не пересоздавать, использовать как основу):\n${dnaText}`;
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
    .text("🔄 Ещё варианты", "naming:more")
    .text("✏️ Доработать", "naming:revise")
    .row()
    .text("↩️ К стратегии", "goto:2")
    .text("📊 Статус", "nav:status");
}

export async function handleNamingBackToDna(ctx: BotContext) {
  await ctx.answerCallbackQuery();
  const { showOrRunModule } = await import("./moduleNav");
  await showOrRunModule(ctx, 2);
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
  await ctx.reply("💭 Думаю...");

  const previousNames = await getAllPreviousNames(projectId);
  const input = await buildNamingInput(projectId);
  const namingText = await generateWithClaude(
    buildNamingSystemPrompt(previousNames) +
    `\n\n<naming_methodology>\n${getNamingSkill()}\n</naming_methodology>` +
    "\n\n" + await getStyleGuide(),
    input,
    { projectId, moduleNum: MODULE_NUM, maxTokens: 3000 }
  );

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

  await updateCurrentModule(projectId, MODULE_NUM);
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
  await ctx.reply("💭 Думаю...");

  const previousNames = await getAllPreviousNames(projectId);
  const input = await buildNamingInput(projectId);

  const namingText = await generateWithClaude(
    buildNamingSystemPrompt(previousNames) +
    `\n\n<naming_methodology>\n${getNamingSkill()}\n</naming_methodology>` +
    "\n\n" + await getStyleGuide(),
    input,
    { projectId, moduleNum: MODULE_NUM, maxTokens: 3000 }
  );

  const existing = await getLatestArtifact(projectId, "verbal_system");

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
  await ctx.reply("💭 Думаю...");

  const [previousNames, existing] = await Promise.all([
    getAllPreviousNames(projectId),
    getLatestArtifact(projectId, "verbal_system"),
  ]);
  const prevNaming = (existing?.data as Record<string, string> | null)?.naming ?? "";

  const namingText = await generateWithClaude(
    REVISION_SYSTEM_PREFIX +
    buildNamingSystemPrompt(previousNames) +
    `\n\n<naming_methodology>\n${getNamingSkill()}\n</naming_methodology>` +
    "\n\n" + await getStyleGuide(),
    `Текущий результат:\n${prevNaming}\n\nКомментарий клиента:\n${comment}\n\nОбнови нейминг с учётом комментария. Сохрани всё что не было критиковано.`,
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
  const cleanName = extractCleanName(selection);
  ctx.session.pending_selection = cleanName;
  ctx.session.awaiting_input = null;

  const kb = new InlineKeyboard()
    .text("✅ Подтвердить", "naming_proceed")
    .text("↩️ Вернуться к вариантам", "verbal:back_to_naming");

  await ctx.reply(
    `Отлично, название — *«${cleanName}»*. Переходим к вербальной системе?`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
}

export async function handleNamingProceed(ctx: BotContext) {
  await ctx.answerCallbackQuery();
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  const selection = ctx.session.pending_selection;
  if (!selection) {
    await ctx.reply(
      "Название не выбрано. Нажмите «⭐ Выбрать направление» и напишите название.",
      { reply_markup: namingKeyboard() }
    );
    return;
  }
  ctx.session.pending_selection = null;

  await ctx.reply(`Разрабатываю вербальную систему для «${selection}»...`);
  await ctx.api.sendChatAction(ctx.chat!.id, "typing");
  await ctx.reply("💭 Думаю...");

  const input = await buildVerbalInput(projectId, selection);
  const verbalText = await generateWithClaude(VERBAL_SYSTEM_PROMPT + "\n\n" + await getStyleGuide(), input, {
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
  await ctx.reply("💭 Думаю...");

  const existing = await getLatestArtifact(projectId, "verbal_system");
  const data = (existing?.data as Record<string, string>) ?? {};
  const selection = data.selectedName ?? "";
  const prevVerbal = data.verbal ?? "";

  const input = await buildVerbalInput(projectId, selection);
  const verbalText = await generateWithClaude(
    REVISION_SYSTEM_PREFIX + VERBAL_SYSTEM_PROMPT + "\n\n" + await getStyleGuide(),
    `Текущий результат:\n${prevVerbal}\n\nКомментарий клиента:\n${comment}\n\nОбнови вербальную систему с учётом комментария. Сохрани всё что не было критиковано.`,
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
