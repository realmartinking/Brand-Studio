import "dotenv/config";
import { Bot, InlineKeyboard, session } from "grammy";
import { globalErrorHandler } from "./middleware/errorHandler";
import { sessionRecovery } from "./middleware/sessionRecovery";
import { RedisAdapter } from "@grammyjs/storage-redis";
import { redis } from "./redis";
import { initialSession } from "./session";
import { BotContext } from "./types";
import { findOrCreateUser } from "./db/users";
import { getUserRole } from "./db/queries";
import { handleNewProject } from "./handlers/newProject";
import { handleMyProjects, handleProjectSelected } from "./handlers/myProjects";
import {
  handleSummarize,
  handleContinueDialog,
  handleApproveBrief,
  handleAmendBrief,
  handleDownloadBrief,
  resumeBriefingDialog,
  restartBriefingDialog,
} from "./briefing/dialog";
import {
  runBrandDna,
  handleDnaApprove,
  handleDnaRevise,
  handleDnaBackToBrief,
} from "./modules/brandDna";
import {
  runNaming,
  handleNamingMore,
  handleNamingRevise,
  handleNamingSelect,
  handleNamingProceed,
  handleVerbalApprove,
  handleVerbalRevise,
  handleBackToNaming,
} from "./modules/naming";
import {
  runConceptDirection,
  handleConceptMore,
  handleConceptRevise,
  handleConceptSelect,
  handleConceptProceed,
  handleConceptApprove,
  handleConceptReviseSelected,
  handleBackToConcepts,
} from "./modules/conceptDirection";
import {
  runVisualIdentity,
  handleVisualApprove,
  handleVisualRevise,
  handleBackToConcepts as handleVisualBackToConcepts,
} from "./modules/visualIdentity";
import {
  runDeliverables,
  handleFullReport,
  handleSummary,
  handleDownloadAgain,
  handleBackToDeliverables,
} from "./modules/deliverables";
import {
  MAIN_KEYBOARD,
  handleStatus,
  handleProjects,
  handleModule,
  handleRestart,
  handleExport,
  handleHelp,
  handleProjectSwitch,
  handleContinue,
} from "./handlers/navigation";
import { handleFigmaCommand, handleFigmaPageSelected, handleFigmaClear, handleFigmaLoadMore, handleFigmaStyleGuide, handleFigmaUseAsBrief, handleFigmaSaveRef, handleFigmaNewProject } from "./handlers/figma";
import { handleLearn, handleLearnMore, handleLearnDocument, handleLearnUpdateStyleGuide } from "./handlers/learn";
import {
  handleProjectDocument,
  handlePhotoMessage,
  handleDocUse,
  handleDocSkip,
  handleDocMore,
  handleDocBriefSkip,
  handleDocBriefContinue,
} from "./handlers/pdfUpload";
import { handleNoProjectDocument } from "./handlers/smartFallback";
import { handleUrlMessage } from "./handlers/urlFetch";
import { routeIntent, handleConfirmDelete, handleConfirmDeleteAll } from "./handlers/intentRouter";
import { textInterceptor } from "./handlers/textInterceptor";
import { showOrRunModule, handleStatusWithNav } from "./modules/moduleNav";

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN is not set");
}

const bot = new Bot<BotContext>(token);

bot.use(
  session({
    initial: initialSession,
    storage: new RedisAdapter({ instance: redis }),
  })
);

bot.use(sessionRecovery);

bot.catch(globalErrorHandler);

// ── /start ───────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  const telegramId = BigInt(ctx.from!.id);
  const displayName =
    [ctx.from!.first_name, ctx.from!.last_name].filter(Boolean).join(" ") ||
    ctx.from!.username ||
    null;

  await findOrCreateUser({ telegramId, displayName });

  ctx.session.awaiting_input = null;
  ctx.session.active_project_id = null;
  ctx.session.briefing_step = null;
  ctx.session.module_state = null;
  ctx.session.role = await getUserRole(telegramId);

  const keyboard = new InlineKeyboard()
    .text("🚀 Новый проект", "new_project")
    .text("📂 Мои проекты", "my_projects")
    .row()
    .text("❓ Как это работает", "how_it_works");

  await ctx.reply(
    "Привет! Я — AI бренд-студия Maks Martin.\n\n" +
    "Помогу создать ваш бренд. Для этого я задам пару вопросов, " +
    "и на основе ваших ответов придумаю идею и стратегию, " +
    "затем название и визуальный стиль.\n\n" +
    "Как начнём?",
    { reply_markup: MAIN_KEYBOARD }
  );
  await ctx.reply("Выбери действие:", { reply_markup: keyboard });
});

// ── Commands ──────────────────────────────────────────────────────────────────

bot.command("status", handleStatusWithNav);
bot.command("projects", handleProjects);
bot.command("module", handleModule);
bot.command("restart", handleRestart);
bot.command("export", handleExport);
bot.command("help", handleHelp);
bot.command("continue", handleContinue);
bot.command("figma", handleFigmaCommand);
bot.command("figma_clear", handleFigmaClear);
bot.command("learn", handleLearn);

// ── Main menu ─────────────────────────────────────────────────────────────────

bot.callbackQuery("new_project", handleNewProject);
bot.callbackQuery("my_projects", handleMyProjects);

// ── Project list ──────────────────────────────────────────────────────────────

bot.callbackQuery(/^project:(.+)$/, async (ctx) => {
  await handleProjectSelected(ctx, ctx.match[1]);
});

// ── Project actions ───────────────────────────────────────────────────────────

bot.callbackQuery(/^continue:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const projectId = ctx.match[1];
  ctx.session.active_project_id = projectId;

  const { getProjectById } = await import("./db/projects");
  const project = await getProjectById(projectId);
  if (!project) return;

  ctx.session.current_module = project.currentModule;
  await handleModule(ctx);
});

bot.callbackQuery(/^status:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.active_project_id = ctx.match[1];
  await handleStatus(ctx);
});

bot.callbackQuery(/^results:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.active_project_id = ctx.match[1];
  await handleExport(ctx);
});

// ── Inline nav shortcuts ──────────────────────────────────────────────────────

bot.callbackQuery("nav:status", async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleStatusWithNav(ctx);
});

// ── Module navigation ─────────────────────────────────────────────────────────

bot.callbackQuery("module:1:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  const { startBriefingDialog } = await import("./briefing/dialog");
  ctx.session.awaiting_input = "briefing";
  await startBriefingDialog(ctx);
});

bot.callbackQuery("module:2:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  await runBrandDna(ctx);
});

bot.callbackQuery("module:3:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  await runNaming(ctx);
});

bot.callbackQuery("module:4:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  await runConceptDirection(ctx);
});

bot.callbackQuery("module:5:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  await runVisualIdentity(ctx);
});

bot.callbackQuery("module:6:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  await runDeliverables(ctx);
});

// ── Universal module navigation ───────────────────────────────────────────────

bot.callbackQuery(/^goto:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const moduleNum = parseInt(ctx.match[1], 10);
  await showOrRunModule(ctx, moduleNum);
});

// Resume from /continue
bot.callbackQuery(/^module_resume:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.current_module = parseInt(ctx.match[1], 10);
  await handleModule(ctx);
});

// ── Briefing ──────────────────────────────────────────────────────────────────

bot.callbackQuery("brief:summarize", handleSummarize);
bot.callbackQuery("brief:continue", handleContinueDialog);
bot.callbackQuery("brief:approve", handleApproveBrief);
bot.callbackQuery("brief:amend", handleAmendBrief);
bot.callbackQuery("brief:download", handleDownloadBrief);

// ── Brand DNA ─────────────────────────────────────────────────────────────────

bot.callbackQuery(/^dna:approve:(.+)$/, async (ctx) => {
  await handleDnaApprove(ctx, ctx.match[1]);
});

bot.callbackQuery(/^dna:revise:(.+)$/, async (ctx) => {
  await handleDnaRevise(ctx, ctx.match[1]);
});

bot.callbackQuery("dna:back_to_brief", handleDnaBackToBrief);

// ── Naming ────────────────────────────────────────────────────────────────────

bot.callbackQuery("naming:select", handleNamingSelect);
bot.callbackQuery("naming:more", handleNamingMore);
bot.callbackQuery("naming:revise", handleNamingRevise);
bot.callbackQuery("naming_proceed", handleNamingProceed);

bot.callbackQuery(/^verbal:approve:(.+)$/, async (ctx) => {
  await handleVerbalApprove(ctx, ctx.match[1]);
});

bot.callbackQuery(/^verbal:revise:(.+)$/, async (ctx) => {
  await handleVerbalRevise(ctx, ctx.match[1]);
});

bot.callbackQuery("verbal:back_to_naming", handleBackToNaming);

// ── Concept Direction ─────────────────────────────────────────────────────────

bot.callbackQuery("concept:select", handleConceptSelect);
bot.callbackQuery("concept:more", handleConceptMore);
bot.callbackQuery("concept:revise", handleConceptRevise);
bot.callbackQuery("concept:back", handleBackToConcepts);
bot.callbackQuery("concept_proceed", handleConceptProceed);

bot.callbackQuery(/^concept:approve:(.+)$/, async (ctx) => {
  await handleConceptApprove(ctx, ctx.match[1]);
});

bot.callbackQuery(/^concept:revise_selected:(.+)$/, async (ctx) => {
  await handleConceptReviseSelected(ctx, ctx.match[1]);
});

// ── Visual Identity ───────────────────────────────────────────────────────────

bot.callbackQuery(/^visual:approve:(.+)$/, async (ctx) => {
  await handleVisualApprove(ctx, ctx.match[1]);
});

bot.callbackQuery(/^visual:revise:(.+)$/, async (ctx) => {
  await handleVisualRevise(ctx, ctx.match[1]);
});

bot.callbackQuery("visual:back_to_concepts", handleVisualBackToConcepts);

// ── Deliverables ──────────────────────────────────────────────────────────────

bot.callbackQuery("deliver:full_report", handleFullReport);
bot.callbackQuery("deliver:summary", handleSummary);
bot.callbackQuery("deliver:download_again", handleDownloadAgain);
bot.callbackQuery("deliver:back_to_module", handleBackToDeliverables);

// ── Figma ─────────────────────────────────────────────────────────────────────

bot.callbackQuery(/^figma:page:(.+)$/, async (ctx) => {
  await handleFigmaPageSelected(ctx, ctx.match[1]);
});

bot.callbackQuery("figma:load_more", handleFigmaLoadMore);
bot.callbackQuery("figma:style_guide", handleFigmaStyleGuide);
bot.callbackQuery("figma:use_as_brief", handleFigmaUseAsBrief);
bot.callbackQuery("figma:save_ref", handleFigmaSaveRef);
bot.callbackQuery("figma:new_project", handleFigmaNewProject);
bot.callbackQuery("learn:more", handleLearnMore);
bot.callbackQuery("learn:update_style_guide", handleLearnUpdateStyleGuide);

// ── PDF document callbacks ────────────────────────────────────────────────────

bot.callbackQuery("doc:use", handleDocUse);
bot.callbackQuery("doc:skip", handleDocSkip);
bot.callbackQuery("doc:more", handleDocMore);
bot.callbackQuery("doc:brief_skip", handleDocBriefSkip);
bot.callbackQuery("doc:brief_continue", handleDocBriefContinue);

// ── Photo router ──────────────────────────────────────────────────────────────

bot.on("message:photo", handlePhotoMessage);

// ── Document router ───────────────────────────────────────────────────────────

bot.on("message:document", async (ctx) => {
  if (ctx.session.awaiting_input === "learn") {
    await handleLearnDocument(ctx);
  } else if (ctx.session.active_project_id) {
    await handleProjectDocument(ctx);
  } else {
    await handleNoProjectDocument(ctx);
  }
});

// ── Text message router ───────────────────────────────────────────────────────

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  const { awaiting_input } = ctx.session;

  // Reply keyboard shortcuts — bypass intent routing
  if (text === "🚀 Новый проект") { ctx.session.awaiting_input = "project_name"; await ctx.reply("Как назовём проект?"); return; }
  if (text === "📊 Статус") { await handleStatus(ctx); return; }
  if (text === "📂 Проекты") { await handleProjects(ctx); return; }
  if (text === "❓ Помощь") { await handleHelp(ctx); return; }

  // Global text interceptor — handles navigation keywords even inside module states
  if (await textInterceptor(ctx, text)) return;

  // project_switch expects a list index, not free text — bypass routing
  if (awaiting_input === "project_switch") {
    await handleProjectSwitch(ctx, text);
    return;
  }

  // confirm_restart_brief expects да/нет — bypass routing
  if (awaiting_input === "confirm_restart_brief") {
    if (text.toLowerCase() === "да") {
      ctx.session.awaiting_input = "briefing";
      const { startBriefingDialog } = await import("./briefing/dialog");
      await startBriefingDialog(ctx);
    } else {
      ctx.session.awaiting_input = null;
      await ctx.reply("Отменено.");
    }
    return;
  }

  // URL detection — intercept before intent router (skip during project_name / project_switch / figma_url states)
  const urlMatch = /^https?:\/\/\S+/i.exec(text);
  if (
    urlMatch &&
    awaiting_input !== "project_name" &&
    awaiting_input !== "project_switch" &&
    awaiting_input !== "figma_url"
  ) {
    await handleUrlMessage(ctx, urlMatch[0]);
    return;
  }

  // Everything else goes through the intent router
  await routeIntent(ctx, text);
});

// ── Delete project callbacks ──────────────────────────────────────────────────

bot.callbackQuery(/^confirm_delete:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleConfirmDelete(ctx, ctx.match[1]);
});

bot.callbackQuery("confirm_delete_all", async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleConfirmDeleteAll(ctx);
});

bot.callbackQuery("cancel_delete", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Отменено.");
});

// ── Onboarding / project start callbacks ─────────────────────────────────────

const HOW_IT_WORKS_TEXT =
  "Вы получите готовый бренд — всё что нужно чтобы запуститься и выглядеть профессионально:\n\n" +
  "✦ Стратегия — кто вы, для кого, чем отличаетесь от конкурентов\n" +
  "✦ Название — варианты имени для бизнеса + слоган\n" +
  "✦ Голос бренда — как говорить с клиентами, какой тон и стиль\n" +
  "✦ Визуальный стиль — логотип, цвета, шрифты, настроение, направление дизайна\n" +
  "✦ Логотип — концепции и направления для разработки\n" +
  "✦ Готовый документ — всё в одном файле, который можно передать дизайнеру или использовать самому\n\n" +
  "Как это происходит — 6 коротких шагов:\n" +
  "1. Знакомство — расскажете о бизнесе (или загрузите файл)\n" +
  "2. Стратегия — предложу идею и позиционирование\n" +
  "3. Название — несколько вариантов на выбор\n" +
  "4. Концепции — 3-5 творческих направлений\n" +
  "5. Визуал — логотип, цвета, шрифты, общий стиль\n" +
  "6. Финальный документ — всё в одном месте\n\n" +
  "Каждый шаг можно обсудить и доработать. Обычно занимает 30-40 минут.";

bot.callbackQuery("how_it_works", async (ctx) => {
  await ctx.answerCallbackQuery();
  const kb = new InlineKeyboard().text("🚀 Начать", "new_project");
  await ctx.reply(HOW_IT_WORKS_TEXT, { reply_markup: kb });
});

bot.callbackQuery("start_briefing", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.session.active_project_id) {
    await ctx.reply("Нет активного проекта.");
    return;
  }
  const { startBriefingDialog } = await import("./briefing/dialog");
  await startBriefingDialog(ctx);
});

bot.callbackQuery("briefing_resume", async (ctx) => {
  await ctx.answerCallbackQuery();
  await resumeBriefingDialog(ctx);
});

bot.callbackQuery("briefing_restart", async (ctx) => {
  await ctx.answerCallbackQuery();
  await restartBriefingDialog(ctx);
});

bot.callbackQuery("upload_file", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Загрузите PDF-файл — я извлеку информацию и соберу бриф самостоятельно.");
});

bot.callbackQuery("module_restart_confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleRestart(ctx);
});

bot.start();
console.log("Bot is running...");
