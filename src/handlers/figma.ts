import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import {
  extractFileKeyFromUrl,
  getFilePages,
  getPageTextContent,
} from "../integrations/figma";
import { saveFigmaReference } from "../db/figmaRefs";

// ── /figma [url] ──────────────────────────────────────────────────────────────

export async function handleFigmaCommand(ctx: BotContext): Promise<void> {
  const args = ctx.message?.text?.split(" ").slice(1).join(" ").trim();

  if (!args) {
    await ctx.reply(
      "Укажи ссылку на Figma-файл:\n`/figma https://www.figma.com/design/КЛЮЧ/...`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  const fileKey = extractFileKeyFromUrl(args);
  if (!fileKey) {
    await ctx.reply(
      "Не удалось извлечь ключ файла из ссылки. Убедись, что ссылка формата:\n`https://www.figma.com/design/КЛЮЧ/...`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  await ctx.reply("⏳ Загружаю страницы файла Figma...");

  let pages: Array<{ id: string; name: string }>;
  try {
    pages = await getFilePages(fileKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Ошибка при обращении к Figma API:\n${message}`);
    return;
  }

  if (pages.length === 0) {
    await ctx.reply("В этом файле нет страниц.");
    return;
  }

  ctx.session.figma_file_key = fileKey;

  const keyboard = new InlineKeyboard();
  for (const page of pages) {
    keyboard.text(page.name, `figma:page:${page.id}`).row();
  }

  await ctx.reply(
    `Найдено страниц: *${pages.length}*\nВыбери страницу для извлечения текста:`,
    { reply_markup: keyboard, parse_mode: "Markdown" }
  );
}

// ── Callback: figma:page:{pageId} ─────────────────────────────────────────────

export async function handleFigmaPageSelected(
  ctx: BotContext,
  pageId: string
): Promise<void> {
  await ctx.answerCallbackQuery();

  const fileKey = ctx.session.figma_file_key;
  if (!fileKey) {
    await ctx.reply("Сессия устарела. Запусти команду /figma заново.");
    return;
  }

  const projectId = ctx.session.active_project_id;
  if (!projectId) {
    await ctx.reply(
      "Нет активного проекта. Выбери проект через /projects, затем повтори команду /figma."
    );
    return;
  }

  // Get page name from callback message text (best-effort)
  const buttonText =
    ctx.callbackQuery?.message?.reply_markup?.inline_keyboard
      ?.flat()
      .find((btn) => "callback_data" in btn && btn.callback_data === `figma:page:${pageId}`)
      ?.text ?? pageId;

  await ctx.reply(`⏳ Извлекаю текст со страницы «${buttonText}»...`);

  let texts: string[];
  try {
    texts = await getPageTextContent(fileKey, pageId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Ошибка при чтении страницы:\n${message}`);
    return;
  }

  if (texts.length === 0) {
    await ctx.reply("На этой странице нет текстовых элементов.");
    return;
  }

  const content = texts.join("\n\n");
  const preview = content.length > 1500 ? content.slice(0, 1500) + "\n…(обрезано)" : content;

  await ctx.reply(
    `📄 *Текст страницы «${buttonText}»:*\n\n${preview}`,
    { parse_mode: "Markdown" }
  );

  try {
    await saveFigmaReference({
      projectId,
      figmaFileKey: fileKey,
      pageId,
      pageName: buttonText,
      content,
    });
    await ctx.reply(`✅ Референс сохранён в проект (страница «${buttonText}»).`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(
      `⚠️ Текст показан, но сохранить в БД не удалось: ${message}\nВозможно, нужно запустить \`npm run db:push\` для применения миграции.`,
      { parse_mode: "Markdown" }
    );
  }

  ctx.session.figma_file_key = null;
}
