import { BotContext } from "../types";
import { handleStatus, handleProjects, handleHelp } from "./navigation";

/**
 * Checks incoming text against global navigation keywords BEFORE the text
 * reaches any module-specific awaiting_input handler.
 *
 * Returns true if the message was handled (caller should return immediately).
 * Returns false to let normal routing continue.
 */
export async function textInterceptor(ctx: BotContext, text: string): Promise<boolean> {
  const t = text.trim().toLowerCase();

  // Status
  if (t === "статус" || t === "📊 статус" || t === "/status") {
    await handleStatus(ctx);
    return true;
  }

  // Projects list
  if (
    t === "проекты" ||
    t === "мои проекты" ||
    t === "📂 проекты" ||
    t === "/projects"
  ) {
    await handleProjects(ctx);
    return true;
  }

  // Help
  if (
    t === "помощь" ||
    t === "помоги" ||
    t === "❓ помощь" ||
    t === "/help"
  ) {
    await handleHelp(ctx);
    return true;
  }

  // Main menu / back
  if (t === "назад" || t === "меню" || t === "главное меню") {
    await handleHelp(ctx);
    return true;
  }

  return false;
}
