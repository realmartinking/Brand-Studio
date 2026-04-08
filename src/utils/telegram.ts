import { InlineKeyboard, Keyboard } from "grammy";
import { BotContext } from "../types";

const MAX_LENGTH = 4000;
const PART_DELAY_MS = 300;

type ReplyMarkup = InlineKeyboard | Keyboard | { remove_keyboard: true };

interface SendOptions {
  parse_mode?: "Markdown" | "HTML";
  reply_markup?: ReplyMarkup;
}

/**
 * Splits text into ≤4000-char chunks at paragraph boundaries.
 */
function splitText(text: string): string[] {
  if (text.length <= MAX_LENGTH) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;

    if (candidate.length > MAX_LENGTH) {
      if (current) chunks.push(current);

      if (para.length > MAX_LENGTH) {
        // Hard-split oversized paragraphs at word boundaries
        let remaining = para;
        while (remaining.length > MAX_LENGTH) {
          let cut = MAX_LENGTH;
          // Walk back to last space so we don't break mid-word
          while (cut > 0 && remaining[cut] !== " " && remaining[cut] !== "\n") cut--;
          if (cut === 0) cut = MAX_LENGTH; // no space found, hard cut
          chunks.push(remaining.slice(0, cut).trimEnd());
          remaining = remaining.slice(cut).trimStart();
        }
        current = remaining;
      } else {
        current = para;
      }
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends long AI-generated text safely:
 * - Splits at paragraph / word boundaries into ≤4000-char parts
 * - Adds 300ms delay between parts
 * - Attaches reply_markup only to the LAST part
 * - Wraps every send in try-catch — logs errors without crashing the bot
 */
export async function sendLongMessage(
  ctx: BotContext,
  text: string,
  options: SendOptions = {}
): Promise<void> {
  const { parse_mode = "Markdown", reply_markup } = options;
  const parts = splitText(text);

  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    const sendOptions: Record<string, unknown> = { parse_mode };
    if (isLast && reply_markup) sendOptions.reply_markup = reply_markup;

    try {
      await ctx.reply(parts[i], sendOptions);
    } catch (err) {
      const msg = (err as Error).message ?? "";
      console.error(
        `[sendLongMessage] Failed to send part ${i + 1}/${parts.length}:`,
        msg
      );
      // If Telegram rejected due to bad markup, retry without parse_mode
      const isParseError =
        msg.includes("can't parse entities") ||
        msg.includes("Bad Request") ||
        msg.includes("entity");
      if (parse_mode && isParseError) {
        try {
          await ctx.reply(parts[i], {
            ...sendOptions,
            parse_mode: undefined,
          });
        } catch (fallbackErr) {
          console.error(
            `[sendLongMessage] Fallback send also failed:`,
            (fallbackErr as Error).message
          );
        }
      }
    }

    if (!isLast) await sleep(PART_DELAY_MS);
  }
}

/** Backward-compatible alias */
export const sendLong = sendLongMessage;
