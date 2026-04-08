import { InlineKeyboard, InputFile } from "grammy";
import { BotContext } from "../types";
import {
  generateNextQuestion,
  generateStructuredBrief,
} from "../ai/claude";
import {
  getDialog,
  appendDialogMessage,
  saveStructuredBrief,
  completeBrief,
  clearBriefDialog,
} from "../db/briefs";
import { sendLongMessage } from "../utils/telegram";

const OPENING_QUESTION =
  "Расскажите о вашем проекте — что это за бизнес и чего вы хотите добиться?";

export async function startBriefingDialog(ctx: BotContext) {
  const projectId = ctx.session.active_project_id!;

  // Check for existing progress from a previous session
  const existingDialog = await getDialog(projectId);
  const userMessages = existingDialog.filter((m) => m.role === "user");

  if (userMessages.length > 0) {
    const summary = userMessages
      .slice(-3)
      .map((m) => `— ${m.content.slice(0, 100)}${m.content.length > 100 ? "…" : ""}`)
      .join("\n");

    const kb = new InlineKeyboard()
      .text("▶️ Продолжить", "briefing_resume")
      .text("🔄 Начать заново", "briefing_restart");

    await ctx.reply(
      `Вижу что мы уже начинали. Вот что я знаю:\n\n${summary}\n\nПродолжим с этого места?`,
      { reply_markup: kb }
    );
    return;
  }

  await appendDialogMessage(projectId, {
    role: "assistant",
    content: OPENING_QUESTION,
  });

  ctx.session.awaiting_input = "briefing";
  await ctx.reply(OPENING_QUESTION);
}

export async function resumeBriefingDialog(ctx: BotContext): Promise<void> {
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  ctx.session.awaiting_input = "briefing";

  const dialog = await getDialog(projectId);
  const lastAssistant = [...dialog].reverse().find((m) => m.role === "assistant");

  await ctx.reply(
    lastAssistant
      ? `Продолжаем. Последний вопрос:\n\n${lastAssistant.content}`
      : "Продолжаем брифинг. Расскажите о вашем проекте."
  );
}

export async function restartBriefingDialog(ctx: BotContext): Promise<void> {
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await clearBriefDialog(projectId);
  await startBriefingDialog(ctx);
}

export async function handleUserMessage(ctx: BotContext, userText: string) {
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await appendDialogMessage(projectId, { role: "user", content: userText });
  await ctx.api.sendChatAction(ctx.chat!.id, "typing");
  await ctx.reply("💭 Думаю...");

  const dialog = await getDialog(projectId);
  const { text, isComplete } = await generateNextQuestion(dialog);

  await appendDialogMessage(projectId, { role: "assistant", content: text });

  if (isComplete) {
    ctx.session.awaiting_input = "brief_decision";

    const keyboard = new InlineKeyboard()
      .text("✅ Достаточно, подведи итог", "brief:summarize")
      .row()
      .text("✏️ Хочу дополнить", "brief:continue");

    await sendLongMessage(ctx, text, { reply_markup: keyboard });
  } else {
    await sendLongMessage(ctx, text, { parse_mode: undefined });
  }
}

export async function handleSummarize(ctx: BotContext) {
  await ctx.answerCallbackQuery();

  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await ctx.reply("Формирую бриф проекта...");
  await ctx.api.sendChatAction(ctx.chat!.id, "typing");
  await ctx.reply("💭 Думаю...");

  const dialog = await getDialog(projectId);
  const structured = await generateStructuredBrief(dialog);

  await saveStructuredBrief(projectId, structured);

  const keyboard = new InlineKeyboard()
    .text("✅ Всё верно", "brief:approve")
    .text("✏️ Дополнить", "brief:amend")
    .row()
    .text("📄 Скачать", "brief:download");

  await sendLongMessage(ctx, `*Бриф проекта:*\n\n${structured}`, {
    reply_markup: keyboard,
  });
}

export async function handleContinueDialog(ctx: BotContext) {
  await ctx.answerCallbackQuery();
  ctx.session.awaiting_input = "briefing";
  await ctx.reply("Хорошо, продолжим. Что хотите добавить или уточнить?");
}

export async function handleApproveBrief(ctx: BotContext) {
  await ctx.answerCallbackQuery();

  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await completeBrief(projectId);

  ctx.session.awaiting_input = null;
  ctx.session.briefing_step = null;

  const { runBrandDna } = await import("../modules/brandDna");
  await runBrandDna(ctx);
}

export async function handleAmendBrief(ctx: BotContext) {
  await ctx.answerCallbackQuery();
  ctx.session.awaiting_input = "briefing";
  await ctx.reply("Что хотите добавить или изменить в брифе?");
}

export async function handleDownloadBrief(ctx: BotContext) {
  await ctx.answerCallbackQuery();

  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  const { getActiveBrief } = await import("../db/briefs");
  const brief = await getActiveBrief(projectId);
  if (!brief?.summary) {
    await ctx.reply("Бриф ещё не сформирован.");
    return;
  }

  const buffer = Buffer.from(brief.summary, "utf-8");
  try {
    await ctx.replyWithDocument(new InputFile(buffer, "brief.txt"), {
      caption: "Бриф проекта",
    });
  } catch (err) {
    console.error("[handleDownloadBrief] Failed to send file:", (err as Error).message);
    await sendLongMessage(ctx, `*Бриф проекта:*\n\n${brief.summary}`);
  }
}
