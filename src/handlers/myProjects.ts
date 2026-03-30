import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { getUserProjects, getProjectById } from "../db/projects";
import { getProjectState, continueKeyboard, progressSummary, MODULES } from "../utils/nextStep";

const STATUS_LABELS: Record<string, string> = {
  draft: "📝 Черновик",
  briefing: "📋 Брифинг",
  in_progress: "⚙️ В работе",
  review: "👀 На проверке",
  completed: "✅ Завершён",
  archived: "🗄 Архив",
};

export async function handleMyProjects(ctx: BotContext) {
  await ctx.answerCallbackQuery();

  const telegramId = BigInt(ctx.from!.id);
  const userProjects = await getUserProjects(telegramId);

  if (userProjects.length === 0) {
    const keyboard = new InlineKeyboard().text("🚀 Создать проект", "new_project");
    await ctx.reply("У вас пока нет проектов.", { reply_markup: keyboard });
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const project of userProjects) {
    const label = STATUS_LABELS[project.status] ?? project.status;
    const active = project.id === ctx.session.active_project_id ? " ◀" : "";
    keyboard.text(`${project.name} — ${label}${active}`, `project:${project.id}`).row();
  }

  await ctx.reply("Ваши проекты:", { reply_markup: keyboard });
}

export async function handleProjectSelected(ctx: BotContext, projectId: string) {
  await ctx.answerCallbackQuery();

  const project = await getProjectById(projectId);
  if (!project) {
    await ctx.reply("Проект не найден.");
    return;
  }

  // Switch active project
  ctx.session.active_project_id = projectId;
  ctx.session.current_module = project.currentModule;
  ctx.session.awaiting_input = null;
  ctx.session.module_state = null;
  ctx.session.briefing_step = null;

  const state = await getProjectState(projectId);
  if (!state) return;

  const nextMod = state.nextModule ? MODULES[state.nextModule] : null;
  const progress = progressSummary(state);

  const headerLine = state.isCompleted
    ? "🎉 Проект завершён"
    : nextMod
      ? `Следующий шаг: *${nextMod.name}*`
      : "";

  await ctx.reply(
    `*${project.name}*\n\n${progress}\n\n${headerLine}`,
    { parse_mode: "Markdown", reply_markup: continueKeyboard(state) }
  );
}
