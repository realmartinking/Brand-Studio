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
  console.log(`[/figma] command received, args="${args}"`);

  if (!args) {
    await ctx.reply(
      "Укажи ссылку на Figma-файл:\n`/figma https://www.figma.com/design/КЛЮЧ/...`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  const fileKey = extractFileKeyFromUrl(args);
  console.log(`[/figma] extracted fileKey="${fileKey}"`);

  if (!fileKey) {
    await ctx.reply(
      "Не удалось извлечь ключ файла из ссылки.\nУбедись, что ссылка формата:\n`https://www.figma.com/design/КЛЮЧ/...`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  await ctx.reply("⏳ Загружаю страницы файла Figma...");

  let pages: Array<{ id: string; name: string }>;
  try {
    pages = await getFilePages(fileKey);
    console.log(`[/figma] loaded ${pages.length} pages for fileKey="${fileKey}"`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[/figma] getFilePages error:`, err);
    await ctx.reply(`❌ Ошибка при обращении к Figma API:\n\`${message}\``, {
      parse_mode: "Markdown",
    });
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
  console.log(`[figma:page] selected pageId="${pageId}"`);

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

  console.log(`[figma:page] fileKey="${fileKey}", projectId="${projectId}"`);

  // Re-fetch pages to get the name for this pageId reliably
  let pageName = pageId;
  try {
    const pages = await getFilePages(fileKey);
    pageName = pages.find((p) => p.id === pageId)?.name ?? pageId;
  } catch {
    // non-critical — continue without name
    console.warn(`[figma:page] could not re-fetch pages for name lookup`);
  }

  console.log(`[figma:page] pageName="${pageName}"`);
  await ctx.reply(`⏳ Извлекаю текст со страницы «${pageName}»...`);

  let texts: string[];
  try {
    texts = await getPageTextContent(fileKey, pageId);
    console.log(`[figma:page] extracted ${texts.length} text items`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[figma:page] getPageTextContent error:`, err);
    await ctx.reply(`❌ Ошибка при чтении страницы:\n\`${message}\``, {
      parse_mode: "Markdown",
    });
    return;
  }

  if (texts.length === 0) {
    await ctx.reply("На этой странице нет текстовых элементов.");
    return;
  }

  const content = texts.join("\n\n");
  const preview =
    content.length > 1500 ? content.slice(0, 1500) + "\n…(обрезано)" : content;

  await ctx.reply(`📄 *Текст страницы «${pageName}»:*\n\n${preview}`, {
    parse_mode: "Markdown",
  });

  try {
    await saveFigmaReference({
      projectId,
      figmaFileKey: fileKey,
      pageId,
      pageName,
      content,
    });
    console.log(`[figma:page] reference saved to DB`);
    await ctx.reply(`✅ Референс сохранён в проект (страница «${pageName}»).`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[figma:page] saveFigmaReference error:`, err);
    await ctx.reply(
      `⚠️ Текст показан, но сохранить в БД не удалось:\n\`${message}\`\n\nВозможно, нужно применить миграцию: \`npm run db:push\``,
      { parse_mode: "Markdown" }
    );
  }

  ctx.session.figma_file_key = null;
}
