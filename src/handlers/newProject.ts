import { BotContext } from "../types";
import { findOrCreateUser } from "../db/users";
import { createProject } from "../db/projects";
import { startBriefingDialog } from "../briefing/dialog";

export async function handleNewProject(ctx: BotContext) {
  ctx.session.awaiting_input = "project_name";
  await ctx.answerCallbackQuery();
  await ctx.reply("Как назовём проект?");
}

export async function handleProjectNameInput(ctx: BotContext) {
  const name = ctx.message?.text?.trim();
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

  await ctx.reply(
    `Проект «${name}» создан!\n\nНачинаем брифинг — я задам несколько вопросов, чтобы глубоко понять ваш проект.`
  );

  await startBriefingDialog(ctx);
}
