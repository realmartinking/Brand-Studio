import "dotenv/config";
import { Bot, InlineKeyboard, session } from "grammy";
import { globalErrorHandler } from "./middleware/errorHandler";
import { sessionRecovery } from "./middleware/sessionRecovery";
import { RedisAdapter } from "@grammyjs/storage-redis";
import { redis } from "./redis";
import { initialSession } from "./session";
import { BotContext } from "./types";
import { findOrCreateUser } from "./db/users";
import { handleNewProject, handleProjectNameInput } from "./handlers/newProject";
import { handleMyProjects, handleProjectSelected } from "./handlers/myProjects";
import {
  handleUserMessage,
  handleSummarize,
  handleContinueDialog,
  handleApproveBrief,
  handleAmendBrief,
  handleDownloadBrief,
} from "./briefing/dialog";
import {
  runBrandDna,
  handleDnaApprove,
  handleDnaRevise,
  handleDnaRevisionInput,
  handleDnaBackToBrief,
} from "./modules/brandDna";
import {
  runNaming,
  handleNamingMore,
  handleNamingRevise,
  handleNamingRevisionInput,
  handleNamingSelect,
  handleNamingSelectInput,
  handleVerbalApprove,
  handleVerbalRevise,
  handleVerbalRevisionInput,
  handleBackToNaming,
} from "./modules/naming";
import {
  runConceptDirection,
  handleConceptMore,
  handleConceptRevise,
  handleConceptRevisionInput,
  handleConceptSelect,
  handleConceptSelectInput,
  handleConceptApprove,
  handleConceptReviseSelected,
  handleConceptSelectedRevisionInput,
  handleBackToConcepts,
} from "./modules/conceptDirection";
import {
  runVisualIdentity,
  handleVisualApprove,
  handleVisualRevise,
  handleVisualRevisionInput,
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
import { handleFigmaCommand, handleFigmaPageSelected, handleFigmaClear, handleFigmaLoadMore, handleFigmaStyleGuide } from "./handlers/figma";
import { handleLearn, handleLearnMore, handleLearnDocument } from "./handlers/learn";

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

  const keyboard = new InlineKeyboard()
    .text("🚀 Новый проект", "new_project")
    .text("📂 Мои проекты", "my_projects");

  await ctx.reply("Привет! Чем займёмся?", {
    reply_markup: MAIN_KEYBOARD,
  });
  await ctx.reply("Выбери действие:", { reply_markup: keyboard });
});

// ── Commands ──────────────────────────────────────────────────────────────────

bot.command("status", handleStatus);
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
  await handleStatus(ctx);
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
bot.callbackQuery("learn:more", handleLearnMore);

// ── Document router (PDF uploads in learn mode) ───────────────────────────────

bot.on("message:document", async (ctx) => {
  if (ctx.session.awaiting_input === "learn") {
    await handleLearnDocument(ctx);
  }
});

// ── Text message router ───────────────────────────────────────────────────────

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  const { awaiting_input } = ctx.session;

  // Reply keyboard shortcuts
  if (text === "📊 Статус") { await handleStatus(ctx); return; }
  if (text === "📂 Проекты") { await handleProjects(ctx); return; }
  if (text === "❓ Помощь") { await handleHelp(ctx); return; }

  // Project switch (after /projects)
  if (awaiting_input === "project_switch") {
    await handleProjectSwitch(ctx, text);
    return;
  }

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

  if (awaiting_input === "project_name") {
    await handleProjectNameInput(ctx);
    return;
  }

  if (awaiting_input === "briefing") {
    await handleUserMessage(ctx, text);
    return;
  }

  if (awaiting_input === "brand_dna_revision") {
    await handleDnaRevisionInput(ctx, text);
    return;
  }

  if (awaiting_input === "naming_revision") {
    await handleNamingRevisionInput(ctx, text);
    return;
  }

  if (awaiting_input === "naming_select") {
    await handleNamingSelectInput(ctx, text);
    return;
  }

  if (awaiting_input === "verbal_revision") {
    await handleVerbalRevisionInput(ctx, text);
    return;
  }

  if (awaiting_input === "concept_revision") {
    await handleConceptRevisionInput(ctx, text);
    return;
  }

  if (awaiting_input === "concept_select") {
    await handleConceptSelectInput(ctx, text);
    return;
  }

  if (awaiting_input === "concept_selected_revision") {
    await handleConceptSelectedRevisionInput(ctx, text);
    return;
  }

  if (awaiting_input === "visual_revision") {
    await handleVisualRevisionInput(ctx, text);
    return;
  }
});

bot.start();
console.log("Bot is running...");
