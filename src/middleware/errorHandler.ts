import { BotError, GrammyError, HttpError } from "grammy";
import { BotContext } from "../types";

const STALE_QUERY_PHRASES = [
  "query is too old",
  "query ID is invalid",
  "response timeout expired",
];

function isStaleCallback(err: unknown): boolean {
  return (
    err instanceof GrammyError &&
    STALE_QUERY_PHRASES.some((phrase) =>
      err.description.toLowerCase().includes(phrase)
    )
  );
}

export async function globalErrorHandler(err: BotError<BotContext>) {
  const ctx = err.ctx;
  const error = err.error;

  // ── Stale callback query ──────────────────────────────────────────────────
  if (isStaleCallback(error)) {
    try {
      await ctx.reply(
        "⏳ Это сообщение устарело.\nНапишите /status чтобы продолжить работу."
      );
    } catch {
      // If we can't reply, silently ignore
    }
    return;
  }

  // ── Log all errors ────────────────────────────────────────────────────────
  if (error instanceof GrammyError) {
    console.error(`[BotError] GrammyError ${error.error_code}: ${error.description}`);
  } else if (error instanceof HttpError) {
    console.error(`[BotError] HttpError: ${error.message}`);
  } else {
    console.error(`[BotError] Unknown error:`, error);
  }

  // ── Notify user ───────────────────────────────────────────────────────────
  try {
    await ctx.reply(
      "⚠️ Произошла ошибка. Попробуйте ещё раз или напишите /start"
    );
  } catch {
    // If we can't even send the error message, log and move on
    console.error("[BotError] Failed to send error message to user");
  }
}
