import Anthropic from "@anthropic-ai/sdk";
import { getStyleGuide } from "../prompts/styleGuide";

export const claude = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

export const CLAUDE_MODEL = "claude-sonnet-4-20250514";

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
  const response = await claude.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: BRIEFING_SYSTEM_PROMPT + "\n\n" + await getStyleGuide(),
    messages: dialog,
  });

  const raw = (response.content[0] as Anthropic.TextBlock).text;
  const isComplete = raw.includes("[BRIEF_COMPLETE]");
  const text = raw.replace("[BRIEF_COMPLETE]", "").trimEnd();

  return { text, isComplete };
}

export async function generateStructuredBrief(
  dialog: DialogMessage[]
): Promise<string> {
  const transcript = dialog
    .map((m) => `${m.role === "user" ? "Клиент" : "Стратег"}: ${m.content}`)
    .join("\n\n");

  const response = await claude.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    system: SUMMARY_SYSTEM_PROMPT + "\n\n" + await getStyleGuide(),
    messages: [{ role: "user", content: transcript }],
  });

  return (response.content[0] as Anthropic.TextBlock).text;
}
