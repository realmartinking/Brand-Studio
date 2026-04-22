import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { generateWithClaude } from "../ai/gateway";
import { handleStatus, handleExport, handleHelp, handleProjects, handleModule, handleRestart } from "./navigation";
import { handleProjectNameInput } from "./newProject";
import { handleUserMessage, handleSummarize } from "../briefing/dialog";
import { handleDnaRevisionInput } from "../modules/brandDna";
import {
  handleNamingRevisionInput,
  handleNamingSelectInput,
  handleVerbalRevisionInput,
  extractCleanName,
} from "../modules/naming";
import {
  handleConceptRevisionInput,
  handleConceptSelectInput,
  handleConceptSelectedRevisionInput,
} from "../modules/conceptDirection";
import { handleVisualRevisionInput } from "../modules/visualIdentity";
import { getUserProjects, getProjectById, deleteProject, deleteAllUserProjects } from "../db/projects";
import { handleUrlMessage } from "./urlFetch";
import { findOrCreateUser } from "../db/users";
import { getDialog } from "../db/briefs";
import { getProjectState, continueKeyboard } from "../utils/nextStep";
import { getStyleGuide } from "../prompts/styleGuide";

// ── Types ─────────────────────────────────────────────────────────────────────

interface IntentResult {
  intent: string;
  entity: string;
}

interface ModuleIntentResult {
  intent: "REVISION" | "APPROVE" | "SELECT" | "UNRELATED" | "UNCLEAR";
  message_to_user: string;
}

// ── Module stage metadata ─────────────────────────────────────────────────────

const MODULE_STAGE_NAMES: Record<number, string> = {
  2: "Brand DNA (стратегическая платформа бренда)",
  3: "Нейминг и вербальная система",
  4: "Концептуальные направления",
  5: "Визуальная идентичность",
  6: "Финальный документ бренда",
};

// States where the module classifier should activate (module is active, no unrelated flow running)
const MODULE_CONTEXT_STATES = new Set<string | null>([
  null,
  "brand_dna_revision",
  "naming_revision",
  "naming_select",
  "verbal_revision",
  "concept_revision",
  "concept_select",
  "concept_selected_revision",
  "visual_revision",
]);

// ── Module-context intent classifier ─────────────────────────────────────────

async function classifyModuleIntent(
  ctx: BotContext,
  text: string
): Promise<ModuleIntentResult> {
  const moduleNum = ctx.session.current_module ?? 0;
  const stageName = MODULE_STAGE_NAMES[moduleNum] ?? "текущий этап";
  const styleGuideText = await getStyleGuide();

  const selectIntentLine =
    moduleNum === 3
      ? `- SELECT — пользователь выбирает конкретное название бренда по тексту ` +
        `(например: «Kortex», «Выбираю Lumina», «мне нравится второй вариант — Aero», «возьмём Nexus»)\n`
      : moduleNum === 4
      ? `- SELECT — пользователь выбирает конкретную концепцию по тексту или номеру ` +
        `(например: «1», «концепция 3», «выбираю второе направление», «мне нравится первое»)\n`
      : "";

  const systemPrompt =
    `Ты — ассистент AI бренд-студии Maks Martin. Пользователь сейчас на этапе «${stageName}» проекта.\n\n` +
    `Пользователь написал сообщение. Определи его намерение. Ответь ТОЛЬКО JSON без markdown:\n` +
    `{"intent": "...", "message_to_user": ""}\n\n` +
    `Возможные intent:\n` +
    `- REVISION — комментарий, пожелание, доработка к текущему результату ` +
    `(например: «добавь ещё варианты», «сделай короче», «хочу русские имена», «мне нравится первый вариант но хочу доработать»)\n` +
    `- APPROVE — принимает результат (например: «ок», «отлично», «принимаю», «идём дальше», «утверждаю»)\n` +
    selectIntentLine +
    `- UNRELATED — сообщение не относится к текущему этапу (например: «покажи проекты», «удали проект», «что ты умеешь»)\n` +
    `- UNCLEAR — непонятно что имеет в виду\n\n` +
    `Если UNCLEAR — в поле message_to_user напиши уточняющий вопрос по-русски. ` +
    `Например: «Вы хотите доработать текущий результат или у вас другой вопрос?»\n` +
    `Для остальных intent поле message_to_user оставь пустым.\n\n` +
    `Контекст студии:\n${styleGuideText}`;

  let raw: string;
  try {
    raw = (
      await generateWithClaude(systemPrompt, text, {
        maxTokens: 150,
        tier: "classifier",
        softFail: true,
      })
    ).trim();
  } catch {
    // Should not reach — softFail returns "" — but be defensive.
    return { intent: "REVISION", message_to_user: "" };
  }

  if (!raw) return { intent: "REVISION", message_to_user: "" };

  try {
    return JSON.parse(raw) as ModuleIntentResult;
  } catch {
    // JSON malformed — treat as revision so the user's text is not lost.
    return { intent: "REVISION", message_to_user: "" };
  }
}

// ── Module revision state resolver ────────────────────────────────────────────

function getModuleRevisionState(ctx: BotContext): string {
  const module = ctx.session.current_module ?? 0;
  const awaiting = ctx.session.awaiting_input ?? "";

  // Preserve a more-specific sub-state if it's already set
  const specificStates = new Set([
    "brand_dna_revision",
    "naming_revision",
    "naming_select",
    "verbal_revision",
    "concept_revision",
    "concept_select",
    "concept_selected_revision",
    "visual_revision",
  ]);
  if (specificStates.has(awaiting)) return awaiting;

  // Default per module
  switch (module) {
    case 2: return "brand_dna_revision";
    case 3: return "naming_revision";
    case 4: return "concept_revision";
    case 5: return "visual_revision";
    default: return "";
  }
}

// ── Shared keyboards ──────────────────────────────────────────────────────────

const startKeyboard = new InlineKeyboard()
  .text("🚀 Новый проект", "new_project")
  .text("❓ Как это работает", "how_it_works");

const startKeyboardWithProjects = new InlineKeyboard()
  .text("🚀 Новый проект", "new_project")
  .text("📂 Мои проекты", "my_projects");

// ── Claude intent classifier ──────────────────────────────────────────────────

async function classifyIntent(ctx: BotContext, text: string): Promise<IntentResult> {
  const projectId = ctx.session.active_project_id;
  let projectName = "";
  if (projectId) {
    const p = await getProjectById(projectId).catch(() => null);
    projectName = p?.name ?? "";
  }

  const systemPrompt = `Ты — NLU-роутер Telegram-бота брендинговой студии Maks Martin. Определи намерение пользователя.

Контекст:
- active_project: ${projectId ? `есть (${projectName})` : "нет"}
- current_module: ${ctx.session.current_module ?? "нет"}
- awaiting_input: ${ctx.session.awaiting_input ?? "нет"}

Ответь ТОЛЬКО JSON без markdown: {"intent": "...", "entity": "..."}

Возможные intent:
- NEW_PROJECT — хочет создать новый проект
- LIST_PROJECTS — хочет увидеть свои проекты
- DELETE_PROJECT — хочет удалить проект (entity = название если указано)
- DELETE_ALL_PROJECTS — хочет удалить все проекты
- PROJECT_STATUS — хочет узнать статус текущего проекта
- GO_TO_MODULE — хочет перейти к конкретному модулю (entity = номер 1-6)
- EXPORT — хочет экспортировать/скачать результаты
- QUESTION — задаёт вопрос о боте, процессе или возможностях (entity = вопрос)
- PROJECT_NAME — это название проекта (короткое, без вопросительных знаков, awaiting_input=project_name)
- CONTINUE_DIALOG — продолжает текущий диалог (entity = оригинальный текст)
- UPLOAD_INSTEAD — хочет загрузить файл вместо ответа на вопрос
- SKIP — хочет пропустить текущий вопрос брифинга
- FORCE_COMPLETE — хочет закончить брифинг с тем что есть
- SHOW_PROGRESS — хочет увидеть что уже собрано
- SWITCH_PROJECT — хочет переключиться на другой проект (entity = название)
- CANCEL — хочет отменить текущее действие
- HELP — просит помощь по текущему этапу
- GREETING — приветствие, эмодзи, стикер
- APPROVE — хочет утвердить текущий результат модуля
- RESTART_MODULE — хочет начать текущий модуль заново
- GO_BACK — хочет вернуться к предыдущему модулю
- UNCLEAR — непонятное сообщение, не относящееся к брендингу

ВАЖНО: если пользователь находится в процессе работы над модулем (awaiting_input не пустой или current_module установлен) и пишет текст который выглядит как комментарий, фидбэк, пожелание или правка к результату — это CONTINUE_DIALOG, даже если текст длинный или содержит критику. При awaiting_input содержащем "_revision", "_select", "briefing", "naming", "concept", "verbal", "visual" — любой свободный текст по умолчанию CONTINUE_DIALOG.`;

  let raw: string;
  try {
    raw = (
      await generateWithClaude(systemPrompt, text, {
        maxTokens: 100,
        tier: "classifier",
        softFail: true,
      })
    ).trim();
  } catch {
    return { intent: "CONTINUE_DIALOG", entity: text };
  }

  if (!raw) return { intent: "CONTINUE_DIALOG", entity: text };

  try {
    return JSON.parse(raw) as IntentResult;
  } catch {
    return { intent: "CONTINUE_DIALOG", entity: text };
  }
}

// ── Dispatcher to existing module handlers ─────────────────────────────────────

async function dispatchToExistingHandler(
  ctx: BotContext,
  awaiting: string,
  text: string
): Promise<boolean> {
  switch (awaiting) {
    case "project_name":
      await handleProjectNameInput(ctx);
      return true;
    case "briefing":
      await handleUserMessage(ctx, text);
      return true;
    case "brand_dna_revision":
      await handleDnaRevisionInput(ctx, text);
      return true;
    case "naming_revision":
      await handleNamingRevisionInput(ctx, text);
      return true;
    case "naming_select":
      await handleNamingSelectInput(ctx, text);
      return true;
    case "verbal_revision":
      await handleVerbalRevisionInput(ctx, text);
      return true;
    case "concept_revision":
      await handleConceptRevisionInput(ctx, text);
      return true;
    case "concept_select":
      await handleConceptSelectInput(ctx, text);
      return true;
    case "concept_selected_revision":
      await handleConceptSelectedRevisionInput(ctx, text);
      return true;
    case "visual_revision":
      await handleVisualRevisionInput(ctx, text);
      return true;
    default:
      return false;
  }
}

// ── Intent handlers ───────────────────────────────────────────────────────────

async function handleNewProjectIntent(ctx: BotContext): Promise<void> {
  ctx.session.awaiting_input = "project_name";
  await ctx.reply(
    "Как назовём проект?\nМожно название компании, продукта или просто рабочее название."
  );
}

async function handleQuestionIntent(ctx: BotContext, question: string): Promise<void> {
  const projectId = ctx.session.active_project_id;

  const systemPrompt = `Ты — дружелюбный AI-ассистент брендинговой студии Maks Martin. Отвечай на вопросы о боте кратко и по-человечески (2-3 предложения максимум). Не перечисляй список модулей. Отвечай на конкретный вопрос.
Если спрашивают сколько времени — "обычно 30-40 минут".
Если спрашивают что получится — "готовый бренд: стратегия, название, визуальный стиль и финальный документ".
Если спрашивают как работает — объясни в 1-2 предложениях без нумерованных списков.
Контекст: ${projectId ? "пользователь работает над проектом" : "пользователь ещё не начал проект"}.`;

  await ctx.api.sendChatAction(ctx.chat!.id, "typing");
  await ctx.reply("💭 Думаю...");

  let answer: string;
  try {
    answer = (
      await generateWithClaude(systemPrompt, question, {
        maxTokens: 200,
        tier: "default",
        softFail: true,
      })
    ).trim();
    if (!answer) {
      answer =
        "Я помогаю создавать бренды с нуля — от идеи до готового документа. Обычно это 30-40 минут работы.";
    }
  } catch {
    answer =
      "Я помогаю создавать бренды с нуля — от идеи до готового документа. Обычно это 30-40 минут работы.";
  }

  const kb = projectId
    ? new InlineKeyboard().text("▶️ Продолжить", "nav:status")
    : startKeyboard;

  await ctx.reply(answer, { reply_markup: kb });
}

async function handleDeleteProjectIntent(ctx: BotContext, entity: string): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);
  const userProjects = await getUserProjects(telegramId);

  if (userProjects.length === 0) {
    await ctx.reply("У вас нет проектов для удаления.", { reply_markup: startKeyboard });
    return;
  }

  if (entity) {
    const target = userProjects.find((p) =>
      p.name.toLowerCase().includes(entity.toLowerCase())
    );

    if (!target) {
      const list = userProjects.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
      await ctx.reply(`Проект «${entity}» не найден.\n\nВаши проекты:\n${list}`);
      return;
    }

    const kb = new InlineKeyboard()
      .text("⚠️ Удалить", `confirm_delete:${target.id}`)
      .text("❌ Отмена", "cancel_delete");

    await ctx.reply(`Удалить проект «${target.name}»? Это нельзя отменить.`, { reply_markup: kb });
    return;
  }

  const kb = new InlineKeyboard();
  for (const p of userProjects) {
    kb.text(`🗑 ${p.name}`, `confirm_delete:${p.id}`).row();
  }
  kb.text("❌ Отмена", "cancel_delete");

  await ctx.reply("Какой проект удалить?", { reply_markup: kb });
}

async function handleDeleteAllIntent(ctx: BotContext): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);
  const userProjects = await getUserProjects(telegramId);

  if (userProjects.length === 0) {
    await ctx.reply("У вас нет проектов для удаления.", { reply_markup: startKeyboard });
    return;
  }

  const kb = new InlineKeyboard()
    .text("⚠️ Удалить все", "confirm_delete_all")
    .text("❌ Отмена", "cancel_delete");

  await ctx.reply(
    `Удалить ВСЕ проекты (${userProjects.length} шт.)? Это нельзя отменить.`,
    { reply_markup: kb }
  );
}

async function handleGoToModuleIntent(ctx: BotContext, entity: string): Promise<void> {
  if (!ctx.session.active_project_id) {
    await ctx.reply("Нет активного проекта. Создайте или выберите проект.", {
      reply_markup: startKeyboardWithProjects,
    });
    return;
  }

  const num = parseInt(entity, 10);
  if (isNaN(num) || num < 1 || num > 6) {
    await ctx.reply("Укажите номер этапа от 1 до 6. Например: «перейди к этапу 3»");
    return;
  }

  ctx.session.current_module = num;
  await handleModule(ctx);
}

async function handleUploadInsteadIntent(ctx: BotContext): Promise<void> {
  await ctx.reply(
    "Отлично! Загрузите PDF-файл — я извлеку информацию и не буду задавать лишних вопросов."
  );
  // Keep awaiting_input as-is so existing flow continues after file
}

async function handleSkipIntent(ctx: BotContext): Promise<void> {
  const projectId = ctx.session.active_project_id;
  if (!projectId || ctx.session.awaiting_input !== "briefing") {
    await ctx.reply("Нечего пропускать.");
    return;
  }
  await handleUserMessage(ctx, "Пропусти этот вопрос, перейди к следующему.");
}

async function handleForceCompleteIntent(ctx: BotContext): Promise<void> {
  const projectId = ctx.session.active_project_id;
  if (!projectId) {
    await ctx.reply("Нет активного проекта.", { reply_markup: startKeyboardWithProjects });
    return;
  }

  ctx.session.awaiting_input = "brief_decision";

  const kb = new InlineKeyboard()
    .text("📋 Посмотреть бриф", "brief:summarize")
    .row()
    .text("✅ Всё верно, продолжаем", "brief:approve");

  await ctx.reply("Понял! Собираю бриф из того, что есть.", { reply_markup: kb });
}

async function handleShowProgressIntent(ctx: BotContext): Promise<void> {
  const projectId = ctx.session.active_project_id;
  if (!projectId) {
    await ctx.reply("Нет активного проекта.", { reply_markup: startKeyboardWithProjects });
    return;
  }

  const dialog = await getDialog(projectId);
  const userMessages = dialog.filter((m) => m.role === "user");

  if (userMessages.length === 0) {
    await ctx.reply("Пока ничего не собрано. Расскажите о вашем проекте!");
    return;
  }

  const summary = userMessages
    .slice(-6)
    .map((m) => `— ${m.content.slice(0, 120)}${m.content.length > 120 ? "…" : ""}`)
    .join("\n");

  const kb = new InlineKeyboard().text("▶️ Продолжить", "nav:status");
  await ctx.reply(`Вот что вы уже рассказали:\n\n${summary}`, { reply_markup: kb });
}

async function handleSwitchProjectIntent(ctx: BotContext, entity: string): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);
  const userProjects = await getUserProjects(telegramId);

  if (userProjects.length === 0) {
    await ctx.reply("У вас нет проектов.", { reply_markup: startKeyboard });
    return;
  }

  if (!entity) {
    await handleProjects(ctx);
    return;
  }

  const target = userProjects.find((p) =>
    p.name.toLowerCase().includes(entity.toLowerCase())
  );

  if (!target) {
    const list = userProjects.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
    await ctx.reply(`Проект «${entity}» не найден.\n\nВаши проекты:\n${list}`);
    return;
  }

  ctx.session.active_project_id = target.id;
  ctx.session.current_module = target.currentModule;
  ctx.session.awaiting_input = null;
  ctx.session.module_state = null;

  const state = await getProjectState(target.id);
  const kb = state ? continueKeyboard(state) : new InlineKeyboard().text("▶️ Продолжить", "nav:status");

  await ctx.reply(`✅ Переключились на *${target.name}*`, {
    parse_mode: "Markdown",
    reply_markup: kb,
  });
}

async function handleCancelIntent(ctx: BotContext): Promise<void> {
  ctx.session.awaiting_input = null;

  const kb = ctx.session.active_project_id
    ? new InlineKeyboard()
        .text("▶️ Продолжить проект", "nav:status")
        .row()
        .text("📂 Мои проекты", "my_projects")
    : startKeyboardWithProjects;

  await ctx.reply("Хорошо! Когда будете готовы — просто напишите.", { reply_markup: kb });
}

async function handleGreetingIntent(ctx: BotContext): Promise<void> {
  const kb = ctx.session.active_project_id
    ? new InlineKeyboard()
        .text("▶️ Продолжить проект", "nav:status")
        .text("📂 Мои проекты", "my_projects")
    : startKeyboard;

  const text = ctx.session.active_project_id
    ? "Привет! У вас есть активный проект."
    : "Привет! Готовы создать бренд?";

  await ctx.reply(text, { reply_markup: kb });
}

async function handleApproveIntent(ctx: BotContext): Promise<void> {
  // Without the run ID we can't trigger module-specific approve callbacks directly.
  // Guide the user to the button shown in the last message.
  await ctx.reply(
    "Используйте кнопку ✅ выше чтобы утвердить результат, или напишите ваши правки."
  );
}

async function handleRestartModuleIntent(ctx: BotContext): Promise<void> {
  if (!ctx.session.active_project_id) {
    await ctx.reply("Нет активного проекта.", { reply_markup: startKeyboardWithProjects });
    return;
  }

  const kb = new InlineKeyboard()
    .text("🔄 Да, заново", "module_restart_confirm")
    .text("❌ Оставить", "cancel_delete");

  await ctx.reply(
    "Начать текущий этап заново? Текущие результаты будут заменены.",
    { reply_markup: kb }
  );
}

async function handleGoBackIntent(ctx: BotContext): Promise<void> {
  const current = ctx.session.current_module ?? 1;
  if (current <= 1) {
    await ctx.reply("Вы уже на первом этапе.");
    return;
  }

  ctx.session.current_module = current - 1;
  ctx.session.awaiting_input = null;
  await handleModule(ctx);
}

async function handleUnclearIntent(ctx: BotContext): Promise<void> {
  const hasProject = !!ctx.session.active_project_id;

  const kb = hasProject
    ? new InlineKeyboard()
        .text("▶️ Продолжить проект", "nav:status")
        .row()
        .text("📊 Статус", "nav:status")
        .text("📂 Проекты", "my_projects")
    : new InlineKeyboard()
        .text("🚀 Новый проект", "new_project")
        .text("📂 Мои проекты", "my_projects")
        .row()
        .text("❓ Как это работает", "how_it_works");

  await ctx.reply("Не совсем понял. Вот что я могу:", { reply_markup: kb });
}

// ── Confirm/cancel callbacks (exported for registration in index.ts) ──────────

export async function handleConfirmDelete(ctx: BotContext, projectId: string): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);
  const displayName =
    [ctx.from!.first_name, ctx.from!.last_name].filter(Boolean).join(" ") || null;
  const user = await findOrCreateUser({ telegramId, displayName });

  const project = await getProjectById(projectId);
  if (!project || project.userId !== user.id) {
    await ctx.reply("Проект не найден.");
    return;
  }

  const name = project.name;
  await deleteProject(projectId);

  if (ctx.session.active_project_id === projectId) {
    ctx.session.active_project_id = null;
    ctx.session.current_module = null;
    ctx.session.module_state = null;
    ctx.session.awaiting_input = null;
  }

  await ctx.reply(`✅ Проект «${name}» удалён.`, { reply_markup: startKeyboardWithProjects });
}

export async function handleConfirmDeleteAll(ctx: BotContext): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);
  const displayName =
    [ctx.from!.first_name, ctx.from!.last_name].filter(Boolean).join(" ") || null;
  const user = await findOrCreateUser({ telegramId, displayName });

  const count = await deleteAllUserProjects(user.id);

  ctx.session.active_project_id = null;
  ctx.session.current_module = null;
  ctx.session.module_state = null;
  ctx.session.awaiting_input = null;

  await ctx.reply(`✅ Удалено ${count} проект(ов).`, { reply_markup: startKeyboard });
}

// ── Main router ───────────────────────────────────────────────────────────────

export async function routeIntent(ctx: BotContext, text: string): Promise<void> {
  if (!text || text.trim().length === 0) {
    await handleUnclearIntent(ctx);
    return;
  }

  // ── figma_url awaiting — Figma link sent after /figma command ────────────
  if (ctx.session.awaiting_input === "figma_url") {
    ctx.session.awaiting_input = null;
    const figmaKeyMatch = text.match(/(?:file|design)\/([a-zA-Z0-9]+)/);
    if (figmaKeyMatch) {
      const { processFigmaFile } = await import("./figma");
      await processFigmaFile(ctx, figmaKeyMatch[1]);
    } else {
      await ctx.reply(
        "Не вижу ссылку на Figma-файл. Попробуйте:\n`/figma https://www.figma.com/design/КЛЮЧ/...`",
        { parse_mode: "Markdown" }
      );
    }
    return;
  }

  // ── URL check — before any Claude classification ─────────────────────────
  const urlRegex = /https?:\/\/[^\s]+/;
  const urlMatch = text.match(urlRegex);
  if (urlMatch) {
    const url = urlMatch[0];
    if (url.includes("figma.com")) {
      await ctx.reply(
        "Вижу ссылку на Figma! Чтобы извлечь текст из файла, используйте команду /figma и затем отправьте ссылку."
      );
      return;
    }
    await handleUrlMessage(ctx, url);
    return;
  }

  // ── Direct keyword shortcuts (no Claude needed) ───────────────────────────
  const lower = text.toLowerCase().trim();
  if (lower === "новый проект" || lower === "new project" || lower === "создать проект") {
    ctx.session.awaiting_input = "project_name";
    await ctx.reply("Как назовём проект?\nМожно название компании, продукта или просто рабочее название.");
    return;
  }

  const awaiting = ctx.session.awaiting_input;

  // ── Module-context classifier (modules 2-6 with no unrelated state active) ─
  const inModuleContext =
    ctx.session.current_module != null &&
    ctx.session.current_module >= 2 &&
    ctx.session.active_project_id != null &&
    MODULE_CONTEXT_STATES.has(awaiting);

  if (inModuleContext) {
    let moduleResult: ModuleIntentResult;
    try {
      moduleResult = await classifyModuleIntent(ctx, text);
    } catch {
      moduleResult = { intent: "REVISION", message_to_user: "" };
    }

    switch (moduleResult.intent) {
      case "REVISION": {
        const revisionState = getModuleRevisionState(ctx);
        if (revisionState) {
          ctx.session.awaiting_input = revisionState;
          const handled = await dispatchToExistingHandler(ctx, revisionState, text);
          if (handled) return;
        }
        break; // fall through if no revision state resolved
      }

      case "APPROVE":
        await handleApproveIntent(ctx);
        return;

      case "SELECT": {
        const module = ctx.session.current_module ?? 0;
        if (module === 3) {
          const cleanName = extractCleanName(text);
          ctx.session.pending_selection = cleanName;
          const kb = new InlineKeyboard()
            .text("✅ Подтвердить", "naming_proceed")
            .text("↩️ Посмотреть варианты", "verbal:back_to_naming");
          await ctx.reply(
            `Понял, выбираете название *«${cleanName}»*. Подтверждаете?`,
            { parse_mode: "Markdown", reply_markup: kb }
          );
        } else if (module === 4) {
          ctx.session.pending_selection = text;
          const kb = new InlineKeyboard()
            .text("✅ Подтвердить", "concept_proceed")
            .text("↩️ Назад к концепциям", "concept:back");
          await ctx.reply(
            `Понял, выбираете концепцию *«${text}»*. Подтверждаете?`,
            { parse_mode: "Markdown", reply_markup: kb }
          );
        }
        return;
      }

      case "UNCLEAR":
        await ctx.reply(
          moduleResult.message_to_user ||
            "Уточните, пожалуйста — вы хотите доработать текущий результат или у вас другой вопрос?"
        );
        return;

      case "UNRELATED":
        // Fall through to the general classifier below
        break;
    }
  }

  let result: IntentResult;
  try {
    result = await classifyIntent(ctx, text);
  } catch {
    result = { intent: "CONTINUE_DIALOG", entity: text };
  }

  const { intent, entity } = result;

  // ── Special case: awaiting project name but user isn't giving one ──────────
  if (awaiting === "project_name" && intent === "CONTINUE_DIALOG") {
    await ctx.reply(
      "Ничего страшного! Напишите любое рабочее название — например, «Кофейня» или «Мой стартап». Потом можно изменить."
    );
    return;
  }

  // ── Continuation: pass through to the current dialog handler ──────────────
  const isContinuation =
    intent === "CONTINUE_DIALOG" ||
    (intent === "PROJECT_NAME" && awaiting === "project_name") ||
    (intent === "SKIP" && awaiting === "briefing") ||
    (intent === "APPROVE" && awaiting && awaiting.endsWith("_revision"));

  if (isContinuation && awaiting) {
    if (intent === "SKIP") {
      await handleSkipIntent(ctx);
      return;
    }
    if (intent === "APPROVE" && awaiting.endsWith("_revision")) {
      await handleApproveIntent(ctx);
      return;
    }
    const handled = await dispatchToExistingHandler(ctx, awaiting, text);
    if (handled) return;
  }

  // ── Navigation intents that work regardless of awaiting_input ─────────────
  switch (intent) {
    case "NEW_PROJECT":
      await handleNewProjectIntent(ctx);
      return;

    case "LIST_PROJECTS":
      await handleProjects(ctx);
      return;

    case "DELETE_PROJECT":
      await handleDeleteProjectIntent(ctx, entity ?? "");
      return;

    case "DELETE_ALL_PROJECTS":
      await handleDeleteAllIntent(ctx);
      return;

    case "PROJECT_STATUS":
      await handleStatus(ctx);
      return;

    case "GO_TO_MODULE":
      await handleGoToModuleIntent(ctx, entity ?? "");
      return;

    case "EXPORT":
      await handleExport(ctx);
      return;

    case "HELP":
      await handleHelp(ctx);
      return;

    case "QUESTION":
      await handleQuestionIntent(ctx, entity || text);
      return;

    case "PROJECT_NAME":
      if (!awaiting) {
        // No active dialog — treat as new project request
        await handleNewProjectIntent(ctx);
      } else {
        // Some other dialog active — pass through
        const handled = await dispatchToExistingHandler(ctx, awaiting, text);
        if (!handled) {
          await ctx.reply("Выберите действие:", { reply_markup: startKeyboardWithProjects });
        }
      }
      return;

    case "UPLOAD_INSTEAD":
      await handleUploadInsteadIntent(ctx);
      return;

    case "SKIP":
      await handleSkipIntent(ctx);
      return;

    case "FORCE_COMPLETE":
      await handleForceCompleteIntent(ctx);
      return;

    case "SHOW_PROGRESS":
      await handleShowProgressIntent(ctx);
      return;

    case "SWITCH_PROJECT":
      await handleSwitchProjectIntent(ctx, entity ?? "");
      return;

    case "CANCEL":
      await handleCancelIntent(ctx);
      return;

    case "GREETING":
      await handleGreetingIntent(ctx);
      return;

    case "APPROVE":
      await handleApproveIntent(ctx);
      return;

    case "RESTART_MODULE":
      await handleRestartModuleIntent(ctx);
      return;

    case "GO_BACK":
      await handleGoBackIntent(ctx);
      return;

    case "UNCLEAR":
      await handleUnclearIntent(ctx);
      return;

    default:
      // CONTINUE_DIALOG with no awaiting_input, or unknown intent
      if (awaiting) {
        const handled = await dispatchToExistingHandler(ctx, awaiting, text);
        if (handled) return;
      }
      await handleUnclearIntent(ctx);
      return;
  }
}
