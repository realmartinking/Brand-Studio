import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { findOrCreateUser } from "../db/users";
import { createProject } from "../db/projects";
import { appendUploadedDocument } from "../db/briefs";

export async function handleNewProject(ctx: BotContext) {
  ctx.session.awaiting_input = "project_name";
  await ctx.answerCallbackQuery();
  await ctx.reply("Как назовём проект?");
}

export async function handleProjectNameInput(ctx: BotContext) {
  const text = (ctx.message?.text ?? "").trim();

  // Если текст слишком длинный (>50 символов) или содержит вопросительный знак — скорее всего это не название
  if (text.length > 50 || text.includes("?")) {
    await ctx.reply(
      "Похоже, это не название проекта. Напиши короткое название — например, «Кофейня Sunrise» или «Ребрендинг Алмаз».",
    );
    return; // awaiting_input остаётся "project_name", ждём настоящее название
  }

  const name = text;
  if (!name) return;

  const telegramId = BigInt(ctx.from!.id);
  const displayName =
    [ctx.from!.first_name, ctx.from!.last_name].filter(Boolean).join(" ") ||
    ctx.from!.username ||
    null;

  const user = await findOrCreateUser({ telegramId, displayName });
  const { project } = await createProject({ userId: user.id, name });

  ctx.session.active_project_id = project.id;
  ctx.session.current_module = 1;
  ctx.session.briefing_step = 0;
  ctx.session.awaiting_input = null;

  // If figma text was pending (user came from Figma extraction without a project), attach it to the new project's brief
  if (ctx.session.pending_figma_text) {
    try {
      await appendUploadedDocument(project.id, {
        filename: "figma_export.txt",
        analysis: ctx.session.pending_figma_text,
        addedAt: new Date().toISOString(),
      });
      ctx.session.pending_figma_text = null;
      await ctx.reply(`Проект «${name}» создан! Текст из Figma добавлен в бриф.`);
    } catch {
      ctx.session.pending_figma_text = null;
      await ctx.reply(`Проект «${name}» создан! (не удалось сохранить текст Figma в бриф)`);
    }

    const keyboard = new InlineKeyboard()
      .text("▶️ Начать работу", "start_briefing")
      .row()
      .text("📊 Статус проекта", "nav:status");
    await ctx.reply("Как продолжим?", { reply_markup: keyboard });
    return;
  }

  const keyboard = new InlineKeyboard()
    .text("💬 Расскажу о проекте", "start_briefing")
    .row()
    .text("📎 Загрузить файл с описанием", "upload_file");

  await ctx.reply(
    `Проект «${name}» создан!\n\nКак хотите начать?`,
    { reply_markup: keyboard }
  );
}
