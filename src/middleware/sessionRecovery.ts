import { NextFunction } from "grammy";
import { BotContext } from "../types";
import { getPersistedSession, updateUserActiveProject } from "../db/users";

/**
 * Restores session from PostgreSQL when Redis session is empty.
 * Runs after the session middleware.
 */
export async function sessionRecovery(ctx: BotContext, next: NextFunction) {
  const telegramId = ctx.from?.id ? BigInt(ctx.from.id) : null;

  if (telegramId && !ctx.session.active_project_id) {
    const persisted = await getPersistedSession(telegramId);
    if (persisted) {
      ctx.session.active_project_id = persisted.project.id;
      ctx.session.current_module = persisted.project.currentModule;
    }
  }

  await next();

  // After handler runs: persist active_project_id back to DB if it changed
  if (telegramId && ctx.session.active_project_id) {
    await updateUserActiveProject(telegramId, ctx.session.active_project_id).catch(
      (err) => console.error("[sessionRecovery] Failed to persist active_project_id:", err)
    );
  }
}
