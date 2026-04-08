import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { claude, CLAUDE_MODEL } from "../ai/claude";

const INTENT_SYSTEM_PROMPT = `Ты помощник бота для брендинговой студии. Пользователь написал сообщение после старта бота. Определи его намерение. Ответь ОДНИМ словом:
- NEW_PROJECT — хочет создать новый проект или начать работу
- QUESTION — задаёт вопрос о боте, его возможностях или процессе
- UPLOAD — хочет загрузить файл или материалы
- OTHER — что-то другое`;

const BOT_DESCRIPTION = `Бот проводит проект через 6 модулей:
1. Брифинг — диалог с вопросами о бизнесе
2. Brand DNA — стратегическая платформа бренда
3. Нейминг — варианты названий и вербальная система
4. Концепции — 3–5 творческих направлений бренда
5. Визуальная идентичность — цвета, типографика, стиль
6. Deliverables — финальный документ и one-pager`;

const startKeyboard = new InlineKeyboard()
  .text("🚀 Новый проект", "new_project")
  .text("📂 Мои проекты", "my_projects");

async function classifyIntent(text: string): Promise<string> {
  const response = await claude.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 10,
    system: INTENT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: text }],
  });
  return (response.content[0] as { type: string; text: string }).text.trim().toUpperCase();
}

export async function handleSmartFallback(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text ?? "";

  let intent: string;
  try {
    intent = await classifyIntent(text);
  } catch {
    intent = "OTHER";
  }

  if (intent.includes("NEW_PROJECT")) {
    ctx.session.awaiting_input = "project_name";
    await ctx.reply(
      "Отлично! Давайте начнём новый проект.\n\nКак называется проект или компания?"
    );
    return;
  }

  if (intent.includes("QUESTION")) {
    await ctx.reply(
      `Вот что умеет этот бот:\n\n${BOT_DESCRIPTION}\n\nДля начала — создайте новый проект.`,
      { reply_markup: startKeyboard }
    );
    return;
  }

  if (intent.includes("UPLOAD")) {
    await ctx.reply(
      "Чтобы загружать файлы и материалы, сначала нужно создать проект.",
      { reply_markup: startKeyboard }
    );
    return;
  }

  // OTHER
  await ctx.reply("Выберите действие:", { reply_markup: startKeyboard });
}

export async function handleNoProjectDocument(ctx: BotContext): Promise<void> {
  await ctx.reply(
    "Чтобы загружать файлы, сначала создайте или выберите проект.",
    { reply_markup: startKeyboard }
  );
}
