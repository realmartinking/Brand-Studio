import { BotContext } from "../types";
import { getActiveBrief } from "../db/briefs";
import { startBriefingDialog as startDialog } from "../briefing/dialog";

export async function startBriefingDialog(ctx: BotContext) {
  const projectId = ctx.session.active_project_id;
  if (!projectId) {
    await ctx.reply("Нет активного проекта.");
    return;
  }

  const brief = await getActiveBrief(projectId);

  if (brief?.status === "complete") {
    await ctx.reply(
      "Бриф уже завершён. Хотите перезапустить диалог?\n\n" +
      "⚠️ Это добавит новый диалог поверх существующего. Напиши «да» для подтверждения."
    );
    ctx.session.awaiting_input = "confirm_restart_brief";
  } else {
    ctx.session.awaiting_input = "briefing";
    await startDialog(ctx);
  }
}
