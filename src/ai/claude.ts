/**
 * Briefing-specific AI helpers.
 *
 * Previously used the Anthropic SDK directly, bypassing retry/fallback/cost tracking.
 * Now delegates to gateway.ts like the rest of the codebase.
 *
 * NOTE: The `claude` and `CLAUDE_MODEL` exports are kept for backward-compatibility
 * with handlers that still import them directly. New code should use gateway.ts.
 * These will be removed once all callers are migrated.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getStyleGuide } from "../prompts/styleGuide";
import { generateDialogWithClaude, generateWithClaude } from "./gateway";
import { MODELS } from "../config/models";

/** @deprecated Import MODELS from config/models or call gateway.ts helpers instead. */
export const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

/** @deprecated Use MODELS.claude.default / .classifier / .hero from config/models. */
export const CLAUDE_MODEL = MODELS.claude.default;

export type DialogMessage = {
  role: "user" | "assistant";
  content: string;
};

const BRIEFING_SYSTEM_PROMPT = `Ты — senior brand strategist. Ты проводишь первую встречу с клиентом.
Твоя задача — глубоко понять проект, чтобы потом создать сильный бренд.

Правила диалога:
- Задавай ОДИН вопрос за раз
- Реагируй на ответ клиента: замечай интересные детали, уточняй
- Если ответ поверхностный — копай глубже
- Если видишь противоречие — мягко укажи на него
- Каждые 3-4 вопроса давай краткий инсайт: что ты уже понял о проекте
- Веди разговор живо, не как анкету
- Спрашивай о: бизнесе, продукте, аудитории, конкурентах, ценностях,
  эмоциях, целях, ограничениях — но в естественном порядке
- Когда считаешь что собрал достаточно информации (обычно 10-15 обменов),
  скажи: "Я собрал достаточно информации для работы. Давайте подведу итог."
  и добавь в конец сообщения маркер [BRIEF_COMPLETE]

Формат ответа: только текст сообщения, без JSON, без разметки.
Если ты готов завершить — добавь [BRIEF_COMPLETE] в самый конец.`;

const SUMMARY_SYSTEM_PROMPT = `Ты — senior brand strategist. Тебе дана история диалога с клиентом.
Сформируй структурированный бриф проекта.

Формат брифа:
**Суть проекта**
...

**Продукт / Услуга**
...

**Целевая аудитория**
...

**Рынок и конкуренты**
...

**Ценности бренда**
...

**Эмоциональный вектор**
...

**Цели проекта**
...

**Ограничения**
...

**Ключевые инсайты из разговора**
...

**Что не было сказано явно, но следует из контекста**
...

Будь конкретным. Используй только то, что реально прозвучало или явно следует из диалога.`;

export async function generateNextQuestion(
  dialog: DialogMessage[]
): Promise<{ text: string; isComplete: boolean }> {
  const systemPrompt = BRIEFING_SYSTEM_PROMPT + "\n\n" + (await getStyleGuide());

  const raw = await generateDialogWithClaude(systemPrompt, dialog, {
    maxTokens: 1024,
    tier: "default",
  });

  const isComplete = raw.includes("[BRIEF_COMPLETE]");
  const text = raw.replace("[BRIEF_COMPLETE]", "").trimEnd();

  return { text, isComplete };
}

export async function generateStructuredBrief(dialog: DialogMessage[]): Promise<string> {
  const transcript = dialog
    .map((m) => `${m.role === "user" ? "Клиент" : "Стратег"}: ${m.content}`)
    .join("\n\n");

  const systemPrompt = SUMMARY_SYSTEM_PROMPT + "\n\n" + (await getStyleGuide());

  return generateWithClaude(systemPrompt, transcript, {
    maxTokens: 2048,
    tier: "default",
  });
}
