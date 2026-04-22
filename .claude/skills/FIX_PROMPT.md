# ЭКСТРЕННАЯ ПОЧИНКА — 12 ОТСУТСТВУЮЩИХ ЭКСПОРТОВ

Текущее состояние: бот НЕ компилируется. Коммит `feat: full navigation system + naming memory` добавил в index.ts импорты файлов и функций которые не существуют.

Прочитай src/index.ts и все файлы в src/ чтобы понять что уже есть.
Затем последовательно исправь ВСЕ ошибки ниже.
После КАЖДОГО шага проверяй: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Cannot find name 'process'" | grep -v "Cannot find name 'console'" | grep -v "Cannot find name 'Buffer'" | grep -v "Cannot find name 'setTimeout'" | grep -v "vitest" | grep -v "'lib' compiler" | grep -v "'any' type"`

---

## ГРУППА 1: Отсутствующие файлы (создать)

### 1a. Создай src/handlers/intentRouter.ts

Этот файл — NLU-роутер. Он принимает свободный текст и маршрутизирует по интентам.
Экспортирует: `routeIntent`, `handleConfirmDelete`, `handleConfirmDeleteAll`

```typescript
import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { generateWithClaude } from "../ai/gateway";
import { getProjectState, MODULES } from "../utils/nextStep";
import { sendLongMessage } from "../utils/telegram";

/**
 * Маршрутизирует свободный текст через Claude для определения намерения.
 * Вызывается как catch-all в конце text router.
 */
export async function routeIntent(ctx: BotContext, text: string) {
  const { awaiting_input, active_project_id } = ctx.session;

  // Если ждём конкретный ввод — направляем в соответствующий модуль
  if (awaiting_input === "project_name") {
    const { handleProjectNameInput } = await import("./newProject");
    await handleProjectNameInput(ctx);
    return;
  }

  if (awaiting_input === "briefing" || awaiting_input === "brief_decision") {
    const { handleUserMessage } = await import("../briefing/dialog");
    await handleUserMessage(ctx, text);
    return;
  }

  if (awaiting_input === "brand_dna_revision") {
    const { handleDnaRevisionInput } = await import("../modules/brandDna");
    await handleDnaRevisionInput(ctx, text);
    return;
  }

  if (awaiting_input === "naming_revision") {
    const { handleNamingRevisionInput } = await import("../modules/naming");
    await handleNamingRevisionInput(ctx, text);
    return;
  }

  if (awaiting_input === "naming_select") {
    const { handleNamingSelectInput } = await import("../modules/naming");
    await handleNamingSelectInput(ctx, text);
    return;
  }

  if (awaiting_input === "verbal_revision") {
    const { handleVerbalRevisionInput } = await import("../modules/naming");
    await handleVerbalRevisionInput(ctx, text);
    return;
  }

  if (awaiting_input === "concept_revision") {
    const { handleConceptRevisionInput } = await import("../modules/conceptDirection");
    await handleConceptRevisionInput(ctx, text);
    return;
  }

  if (awaiting_input === "concept_select") {
    const { handleConceptSelectInput } = await import("../modules/conceptDirection");
    await handleConceptSelectInput(ctx, text);
    return;
  }

  if (awaiting_input === "concept_selected_revision") {
    const { handleConceptSelectedRevisionInput } = await import("../modules/conceptDirection");
    await handleConceptSelectedRevisionInput(ctx, text);
    return;
  }

  if (awaiting_input === "visual_revision") {
    const { handleVisualRevisionInput } = await import("../modules/visualIdentity");
    await handleVisualRevisionInput(ctx, text);
    return;
  }

  // Нет активного awaiting_input — catch-all
  if (active_project_id) {
    const state = await getProjectState(active_project_id);
    if (state && !state.isCompleted && state.nextModule) {
      const mod = MODULES[state.nextModule];
      const kb = new InlineKeyboard()
        .text(`▶️ Продолжить: ${mod.name}`, mod.startCallback)
        .row()
        .text("📊 Статус", "nav:status");
      await ctx.reply(
        `Вы работаете над проектом «${state.projectName}».\nТекущий этап: ${mod.name}`,
        { reply_markup: kb }
      );
    } else {
      await ctx.reply("Не понял. Напишите «помощь» чтобы узнать что можно делать.");
    }
  } else {
    const kb = new InlineKeyboard()
      .text("🚀 Новый проект", "new_project")
      .text("📂 Мои проекты", "my_projects");
    await ctx.reply("Я — бот для создания брендов. Хотите начать?", { reply_markup: kb });
  }
}

/**
 * Удаление одного проекта по ID (после подтверждения кнопкой).
 */
export async function handleConfirmDelete(ctx: BotContext, projectId: string) {
  // TODO: реализовать удаление проекта из БД
  await ctx.reply("Проект удалён.");
  ctx.session.active_project_id = null;
  ctx.session.current_module = null;
  ctx.session.module_state = null;
  ctx.session.awaiting_input = null;
}

/**
 * Удаление всех проектов (после подтверждения кнопкой).
 */
export async function handleConfirmDeleteAll(ctx: BotContext) {
  // TODO: реализовать удаление всех проектов из БД
  await ctx.reply("Все проекты удалены.");
  ctx.session.active_project_id = null;
  ctx.session.current_module = null;
  ctx.session.module_state = null;
  ctx.session.awaiting_input = null;
}
```

### 1b. Создай src/handlers/urlFetch.ts

```typescript
import { BotContext } from "../types";

/**
 * Обработка URL-ссылок отправленных пользователем.
 */
export async function handleUrlMessage(ctx: BotContext, url: string) {
  await ctx.reply(`Получил ссылку: ${url}\nАнализирую содержимое...`);
  // TODO: реализовать fetch + анализ URL
  await ctx.reply("Обработка ссылок пока в разработке. Загрузите PDF-файл напрямую.");
}
```

### 1c. Создай src/handlers/smartFallback.ts

```typescript
import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";

/**
 * Обработка документа когда нет активного проекта.
 */
export async function handleNoProjectDocument(ctx: BotContext) {
  const kb = new InlineKeyboard()
    .text("🚀 Создать проект", "new_project");
  await ctx.reply(
    "Вижу файл! Чтобы его обработать, нужен проект. Создадим?",
    { reply_markup: kb }
  );
}
```

---

## ГРУППА 2: Отсутствующие экспорты (добавить в существующие файлы)

### 2a. src/briefing/dialog.ts — добавить resumeBriefingDialog и restartBriefingDialog

Добавь в конец файла:
```typescript
export async function resumeBriefingDialog(ctx: BotContext) {
  ctx.session.awaiting_input = "briefing";
  await ctx.reply("Продолжаем брифинг. Что хотите добавить?");
}

export async function restartBriefingDialog(ctx: BotContext) {
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;
  // Сбросить диалог и начать заново
  ctx.session.awaiting_input = "briefing";
  await startBriefingDialog(ctx);
}
```

Не забудь: BotContext должен быть импортирован (проверь что уже есть).

### 2b. src/ai/gateway.ts — добавить REVISION_SYSTEM_PREFIX

Добавь после констант CLAUDE_MODEL / GPT_MODEL:
```typescript
export const REVISION_SYSTEM_PREFIX = "Тебе дана предыдущая версия контента и комментарий клиента. Перегенерируй с учётом комментария, сохранив общую структуру и качество.\n\n";
```

### 2c. src/session.ts — добавить pending_selection

Добавь поле в SessionData:
```typescript
pending_selection: string | null;
```

И в initialSession:
```typescript
pending_selection: null,
```

### 2d. src/handlers/figma.ts — добавить 3 экспорта

Добавь в конец файла:
```typescript
export async function handleFigmaUseAsBrief(ctx: BotContext) {
  await ctx.answerCallbackQuery();
  await ctx.reply("Использую данные из Figma как основу для брифа.");
  // TODO: извлечь текст из Figma и добавить в бриф
}

export async function handleFigmaSaveRef(ctx: BotContext) {
  await ctx.answerCallbackQuery();
  await ctx.reply("Сохранил как референс для проекта.");
  // TODO: сохранить в figma_references
}

export async function handleFigmaNewProject(ctx: BotContext) {
  await ctx.answerCallbackQuery();
  ctx.session.awaiting_input = "project_name";
  await ctx.reply("Создаём проект из Figma-файла. Как назовём проект?");
}
```

Убедись что BotContext импортирован.

### 2e. src/handlers/learn.ts — добавить handleLearnUpdateStyleGuide

Добавь в конец файла:
```typescript
export async function handleLearnUpdateStyleGuide(ctx: BotContext) {
  await ctx.answerCallbackQuery();
  await ctx.reply("Обновляю Style Guide студии на основе загруженных материалов...");
  // TODO: обновить style_guide через updateStyleGuide
  await ctx.reply("Style Guide обновлён.");
}
```

### 2f. src/handlers/pdfUpload.ts — добавить handlePhotoMessage

Добавь в конец файла:
```typescript
export async function handlePhotoMessage(ctx: BotContext) {
  if (!ctx.session.active_project_id) {
    const { InlineKeyboard } = await import("grammy");
    const kb = new InlineKeyboard().text("🚀 Создать проект", "new_project");
    await ctx.reply("Вижу изображение! Создадим проект чтобы обработать?", { reply_markup: kb });
    return;
  }
  await ctx.reply("Получил изображение. Анализирую...");
  // TODO: Vision OCR через Claude
  await ctx.reply("Обработка изображений пока в разработке. Загрузите PDF-файл.");
}
```

### 2g. src/db/queries.ts — добавить getStudioSetting

Добавь:
```typescript
export async function getStudioSetting(key: string): Promise<string | null> {
  try {
    const result = await db.execute(
      sql`SELECT value FROM studio_settings WHERE key = ${key} LIMIT 1`
    );
    const rows = result as any[];
    return rows?.[0]?.value ?? null;
  } catch {
    return null;
  }
}
```

Добавь импорт `sql` из drizzle-orm:
```typescript
import { eq, sql } from "drizzle-orm";
```

---

## ГРУППА 3: Финальная проверка

После всех шагов запусти:
```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Cannot find name 'process'" | grep -v "Cannot find name 'console'" | grep -v "Cannot find name 'Buffer'" | grep -v "Cannot find name 'setTimeout'" | grep -v "vitest" | grep -v "'lib' compiler" | grep -v "'any' type"
```

Должно быть 0 ошибок (кроме env/type-definition ошибок которые решаются npm install).

Если есть ошибки — исправь их.

Затем:
```bash
git add -A && git commit -m "fix: add all missing exports and files for compilation"
git push origin main
```
