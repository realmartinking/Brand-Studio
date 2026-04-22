# AI BRAND STUDIO — ГЛОБАЛЬНАЯ ПЕРЕСТРОЙКА UX/UI

## Документ для Claude Code: полная спецификация изменений

---

## ЧАСТЬ 1: ДИАГНОСТИКА — ЧТО СЕЙЧАС СЛОМАНО

### 1.1 Тупики навигации (Dead Ends)

| Сценарий | Что происходит | Где в коде |
|----------|---------------|------------|
| Пользователь в `awaiting_input = "naming_revision"` пишет "мои проекты" | Сообщение игнорируется — нет обработки | `index.ts` text router — нет fallback для неизвестных awaiting_input |
| Пользователь нажимает кнопку старого сообщения | Callback может вызвать ошибку или повторное действие | Нет проверки актуальности callback |
| Пользователь пишет текст на этапе где ожидается кнопка (после Brand DNA) | Текст падает в никуда | Нет text fallback для модульных этапов |
| `module_state` протух (Redis TTL) | Бот не понимает контекст | Нет восстановления из БД |

### 1.2 Потеря памяти неймов

| Проблема | Причина | Файл |
|----------|---------|------|
| При "Сгенерируй ещё" бот помнит только ПОСЛЕДНЮЮ генерацию | `saveArtifact` помечает все предыдущие как `superseded`, `getLatestArtifact` берёт только последний | `db/artifacts.ts`, `modules/naming.ts` |
| При ревизии с комментарием — опять только последний | То же | `handleNamingRevisionInput` |
| Бот может предложить одинаковые имена 3 раза подряд | AI не получает полную историю | `NAMING_SYSTEM_PROMPT` |

### 1.3 Непоследовательность языка UI

| Место | Русский | Английский | Должно быть |
|-------|---------|-----------|-------------|
| MODULES dict | "Бриф" | "Brand DNA", "Concept Direction", "Visual Identity", "Brand Book" | Единый язык |
| Кнопки | "✅ Одобрить", "✏️ Доработать" | "Naming", "Verbal System" | Кнопки — на русском |
| Сообщения | "Запускаю модуль Naming..." | "Модуль Brand DNA..." | Единообразие |
| Статус | "М1: Бриф" | "М4: Concept Direction" | Единый стиль |

### 1.4 Reply Keyboard не адаптивна

Сейчас: фиксированная `MAIN_KEYBOARD` с 3 кнопками (📊 Статус, 📂 Проекты, ❓ Помощь). Не меняется в зависимости от контекста — пользователь всегда видит одно и то же.

### 1.5 Нет Intent Router для текста на модульных этапах

`UX_SPECIFICATION.md` описывает intent router, но в коде его НЕТ. Текст обрабатывается только для конкретных `awaiting_input` значений. Если пользователь пишет "назад" или "покажи статус" во время ревизии — сообщение съедается модулем как текст ревизии.

---

## ЧАСТЬ 2: АРХИТЕКТУРА РЕШЕНИЯ

### 2.1 Единый State Controller

Заменить разрозненные `awaiting_input` строки на типизированный state machine.

**Файл: `src/state/machine.ts`**

```typescript
// Все возможные состояния бота
export type BotState =
  // Глобальные
  | { type: 'idle' }                           // Нет активного проекта
  | { type: 'awaiting_project_name' }          // Ждём название проекта
  | { type: 'project_switch' ; projectIds: string[] }
  
  // Модуль 1: Бриф
  | { type: 'briefing' }                       // Диалог брифинга
  | { type: 'brief_review' }                   // Бриф показан, ждём решения
  
  // Модуль 2: Стратегия
  | { type: 'module_review'; module: number; artifactId: string }
  | { type: 'module_revision'; module: number; artifactId: string }
  
  // Модуль 3: Нейминг
  | { type: 'naming_review' }                  // Показаны варианты
  | { type: 'naming_revision' }                // Ждём комментарий
  | { type: 'naming_select' }                  // Ждём выбор
  | { type: 'verbal_review'; artifactId: string }
  | { type: 'verbal_revision'; artifactId: string }
  
  // Модуль 4: Концепции
  | { type: 'concepts_review' }
  | { type: 'concepts_revision' }
  | { type: 'concept_select' }
  | { type: 'concept_selected_review'; artifactId: string }
  | { type: 'concept_selected_revision'; artifactId: string }
  
  // Модуль 5: Визуал
  | { type: 'visual_review'; artifactId: string }
  | { type: 'visual_revision'; artifactId: string }
  
  // Модуль 6: Упаковка
  | { type: 'deliverables_choice' }            // Выбор формата
  
  // Спец
  | { type: 'learn' }                          // Обучение стилю
  | { type: 'confirm_action'; action: string; payload: any }

// Переходы — что можно делать в каждом состоянии
export const STATE_TRANSITIONS: Record<string, string[]> = {
  'idle': ['awaiting_project_name', 'project_switch'],
  'briefing': ['brief_review', 'idle'],
  'brief_review': ['briefing', 'module_review'],
  // ... все переходы
};
```

### 2.2 Глобальный Text Interceptor

Перед тем как текст попадает в обработчик текущего состояния — проверяем глобальные команды.

**Файл: `src/handlers/textInterceptor.ts`**

```typescript
// Глобальные команды, которые работают ВСЕГДА
const GLOBAL_INTENTS = [
  { patterns: ['статус', 'status', 'где я', 'что дальше'], handler: 'status' },
  { patterns: ['проекты', 'мои проекты', 'projects'], handler: 'projects' },
  { patterns: ['помощь', 'help', 'что делать', 'как'], handler: 'help' },
  { patterns: ['назад', 'back', 'вернись', 'отмена', 'cancel'], handler: 'back' },
  { patterns: ['меню', 'главная', 'menu', 'home', 'начало'], handler: 'menu' },
  { patterns: ['стоп', 'хватит', 'stop'], handler: 'stop' },
];

export async function textInterceptor(ctx: BotContext, text: string): Promise<boolean> {
  const lower = text.toLowerCase().trim();
  
  for (const intent of GLOBAL_INTENTS) {
    if (intent.patterns.some(p => lower.includes(p))) {
      // Если пользователь в середине модуля — предупредить
      if (isInModuleWork(ctx) && intent.handler !== 'status' && intent.handler !== 'help') {
        await ctx.reply(
          `Вы сейчас на этапе "${getCurrentStepName(ctx)}". Прервать и перейти?`,
          { reply_markup: confirmInterruptKeyboard(intent.handler) }
        );
        return true; // intercepted
      }
      await executeGlobalHandler(ctx, intent.handler);
      return true;
    }
  }
  
  return false; // not intercepted, pass to module handler
}
```

### 2.3 Кумулятивная память неймов

**Изменения в `modules/naming.ts`:**

```typescript
// НОВАЯ ФУНКЦИЯ: собирает ВСЕ когда-либо предложенные имена
async function getAllPreviousNames(projectId: string): Promise<string[]> {
  // Берём ВСЕ артефакты типа verbal_system, включая superseded
  const allArtifacts = await db.query.artifacts.findMany({
    where: and(
      eq(artifacts.projectId, projectId),
      eq(artifacts.type, 'verbal_system')
    ),
    orderBy: [asc(artifacts.version)],
  });
  
  const allNames: string[] = [];
  
  for (const artifact of allArtifacts) {
    const data = artifact.data as Record<string, string> | null;
    const naming = data?.naming ?? '';
    // Парсим имена из текста генерации
    const names = extractNamesFromText(naming);
    allNames.push(...names);
  }
  
  return [...new Set(allNames)]; // дедупликация
}

// Парсер имён из текста генерации
function extractNamesFromText(text: string): string[] {
  const names: string[] = [];
  // Паттерн: **Название** — или 1. **Название**
  const regex = /\*\*([^*]+)\*\*/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim();
    if (name.length > 0 && name.length < 50) { // фильтр мусора
      names.push(name);
    }
  }
  return names;
}

// ОБНОВЛЁННЫЙ system prompt с памятью
function buildNamingPrompt(previousNames: string[]): string {
  let prompt = NAMING_SYSTEM_PROMPT; // базовый из NAMING_SKILL
  
  if (previousNames.length > 0) {
    prompt += `\n\n---\nКРИТИЧЕСКОЕ ПРАВИЛО: РАНЕЕ ПРЕДЛОЖЕННЫЕ НАЗВАНИЯ (НЕ ПОВТОРЯЙ НИ ОДНО ИЗ НИХ И ИХ ПРОИЗВОДНЫЕ):\n`;
    prompt += previousNames.join(', ');
    prompt += `\n\nЭти названия уже были предложены клиенту. Предложи ПОЛНОСТЬЮ НОВЫЕ варианты. Не используй те же корни, основы или идеи. Смени типологию, язык, ассоциативный подход.`;
  }
  
  return prompt;
}

// ОБНОВЛЁННЫЙ runNaming
export async function runNaming(ctx: BotContext) {
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await ctx.reply('🏷 Генерирую варианты названий...');
  await ctx.api.sendChatAction(ctx.chat!.id, 'typing');

  const input = await buildNamingInput(projectId);
  const previousNames = await getAllPreviousNames(projectId);
  const systemPrompt = buildNamingPrompt(previousNames);
  
  const namingText = await generateWithClaude(systemPrompt, input, {
    projectId,
    moduleNum: MODULE_NUM,
    maxTokens: 3000,
  });

  // ... save artifact как раньше
}

// ОБНОВЛЁННЫЙ handleNamingMore  
export async function handleNamingMore(ctx: BotContext) {
  await ctx.answerCallbackQuery();
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  await ctx.reply('🔄 Генерирую новые варианты...');
  await ctx.api.sendChatAction(ctx.chat!.id, 'typing');

  const input = await buildNamingInput(projectId);
  const previousNames = await getAllPreviousNames(projectId); // ВСЕ имена, не только последние
  const systemPrompt = buildNamingPrompt(previousNames);
  
  const namingText = await generateWithClaude(systemPrompt, input, {
    projectId,
    moduleNum: MODULE_NUM,
    maxTokens: 3000,
  });
  
  // ... save
}
```

### 2.4 Добавить функцию `getAllArtifactsOfType` в `db/artifacts.ts`

```typescript
export async function getAllArtifactsOfType(projectId: string, type: ArtifactType) {
  return db.query.artifacts.findMany({
    where: and(
      eq(artifacts.projectId, projectId),
      eq(artifacts.type, type)
    ),
    orderBy: [asc(artifacts.version)],
  });
}
```

---

## ЧАСТЬ 3: НОВАЯ СТРУКТУРА НАВИГАЦИИ

### 3.1 Единые названия модулей (русский)

```typescript
export const MODULES: Record<number, ModuleInfo> = {
  1: { num: 1, name: 'Бриф',                   emoji: '📋', startCallback: 'module:1:start' },
  2: { num: 2, name: 'Стратегия бренда',        emoji: '🧬', startCallback: 'module:2:start' },
  3: { num: 3, name: 'Нейминг',                 emoji: '🏷', startCallback: 'module:3:start' },
  4: { num: 4, name: 'Концепции',               emoji: '🎨', startCallback: 'module:4:start' },
  5: { num: 5, name: 'Визуальный стиль',        emoji: '🖼', startCallback: 'module:5:start' },
  6: { num: 6, name: 'Финальный документ',       emoji: '📦', startCallback: 'module:6:start' },
};
```

**Все текстовые упоминания модулей в сообщениях бота — только по-русски.**

### 3.2 Контекстная Reply Keyboard

Вместо одной фиксированной — несколько, переключаемых по контексту:

```typescript
// Базовая (нет проекта)
export const IDLE_KEYBOARD = new Keyboard()
  .text('🚀 Новый проект')
  .text('📂 Проекты')
  .text('❓ Помощь')
  .resized().persistent();

// В работе над проектом
export const PROJECT_KEYBOARD = new Keyboard()
  .text('▶️ Продолжить')
  .text('📊 Статус')
  .row()
  .text('📂 Проекты')
  .text('❓ Помощь')
  .resized().persistent();

// Во время брифинга
export const BRIEFING_KEYBOARD = new Keyboard()
  .text('📋 Итог')
  .text('📎 Файл')
  .row()
  .text('📊 Статус')
  .text('❓ Помощь')
  .resized().persistent();

// Выбор — reply keyboard для текущего контекста
export function getContextKeyboard(ctx: BotContext): Keyboard {
  if (!ctx.session.active_project_id) return IDLE_KEYBOARD;
  if (ctx.session.awaiting_input === 'briefing') return BRIEFING_KEYBOARD;
  return PROJECT_KEYBOARD;
}
```

### 3.3 Универсальные Inline-клавиатуры по паттерну

Каждый модуль использует одну из трёх стандартных клавиатур:

```typescript
// Паттерн A: Результат показан → одобрить / доработать / назад
function reviewKeyboard(module: number, artifactId: string): InlineKeyboard {
  const prevModule = module > 1 ? MODULES[module - 1] : null;
  const kb = new InlineKeyboard()
    .text('✅ Одобрить', `approve:${module}:${artifactId}`)
    .text('✏️ Доработать', `revise:${module}:${artifactId}`)
    .row();
  if (prevModule) {
    kb.text(`↩️ Назад к ${prevModule.name}`, `back:${module}`);
  }
  return kb;
}

// Паттерн B: Варианты показаны → выбрать / ещё / доработать  
function choiceKeyboard(module: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('⭐ Выбрать', `select:${module}`)
    .row()
    .text('🔄 Другие варианты', `more:${module}`)
    .text('✏️ Доработать', `revise:${module}`)
    .row()
    .text(`↩️ Назад`, `back:${module}`);
}

// Паттерн C: Подтверждение опасного действия
function confirmKeyboard(action: string, payload: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('⚠️ Да, подтверждаю', `confirm:${action}:${payload}`)
    .text('❌ Отмена', 'cancel_action');
}
```

### 3.4 Унифицированные callback handlers

Вместо отдельных handler-ов для каждого модуля — единый роутер:

```typescript
// Единый approve handler
bot.callbackQuery(/^approve:(\d+):(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const moduleNum = parseInt(ctx.match[1], 10);
  const artifactId = ctx.match[2];
  await handleModuleApprove(ctx, moduleNum, artifactId);
});

// Единый revise handler
bot.callbackQuery(/^revise:(\d+):(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const moduleNum = parseInt(ctx.match[1], 10);
  const artifactId = ctx.match[2];
  ctx.session.awaiting_input = `module_${moduleNum}_revision`;
  ctx.session.module_state = artifactId;
  await ctx.reply('Что хотите изменить?');
});

// Единый back handler
bot.callbackQuery(/^back:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const moduleNum = parseInt(ctx.match[1], 10);
  await handleModuleBack(ctx, moduleNum);
});

// Единый more handler (нейминг, концепции)
bot.callbackQuery(/^more:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const moduleNum = parseInt(ctx.match[1], 10);
  await handleModuleMore(ctx, moduleNum);
});

// Единый select handler
bot.callbackQuery(/^select:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const moduleNum = parseInt(ctx.match[1], 10);
  ctx.session.awaiting_input = `module_${moduleNum}_select`;
  await ctx.reply('Напишите номер или название выбранного варианта.');
});
```

---

## ЧАСТЬ 4: СЦЕНАРИИ И ПЕРЕХОДЫ — ПОЛНАЯ КАРТА

### 4.1 Жизненный цикл проекта

```
/start → Приветствие → [Новый проект] → Название → 
  → [Расскажу] → Брифинг (диалог) → Итог брифа → [Одобрить] →
  → Стратегия бренда (авто) → Показ → [Одобрить] →
  → Нейминг (авто) → Показ → [Выбрать] → Вербальная система → [Одобрить] →
  → Концепции (авто) → Показ → [Выбрать] → Показ выбранной → [Одобрить] →
  → Визуальный стиль (авто) → Показ → [Одобрить] →
  → Финальный документ → [Полный / Краткий] → Скачать → ГОТОВО
```

### 4.2 Все возможные прерывания (и как их обрабатывать)

| Что может сделать пользователь | На каком этапе | Как обработать |
|-------------------------------|----------------|----------------|
| Написать "статус" или "где я" | Любой | Показать прогресс + кнопку "Вернуться к работе" |
| Написать "мои проекты" | Любой | Показать проекты + "Вы в проекте X. Вернуться?" |
| Написать "назад" | Модуль 2-6 | Спросить: вернуться к предыдущему модулю? |
| Написать "начать заново" | Любой модуль | Подтверждение кнопкой |
| Написать "хватит" во время брифинга | Брифинг | Завершить бриф из того что есть |
| Отправить файл | Любой | Принять, проанализировать, предложить привязку |
| Нажать кнопку из старого сообщения | Любой | Проверить актуальность, если устарела — вежливо сказать |
| Не отвечать 24 часа | Любой | При возврате — напомнить где остановились |
| Написать текст вместо нажатия кнопки | Обзор модуля | Понять intent: если похоже на фидбэк — считать ревизией |

### 4.3 Обработка "текст вместо кнопки" на каждом этапе

```typescript
// В text router, ПОСЛЕ проверки awaiting_input,
// но ПЕРЕД отправкой в default fallback:

// Если пользователь на этапе обзора результата модуля
// и пишет текст — это скорее всего фидбэк/ревизия
if (isModuleReviewState(ctx) && !isGlobalCommand(text)) {
  // Трактуем как запрос ревизии
  await handleImplicitRevision(ctx, text);
  return;
}
```

### 4.4 Сценарий возврата после паузы

```typescript
// При любом входящем сообщении, если нет активного состояния:
if (!ctx.session.awaiting_input && ctx.session.active_project_id) {
  const state = await getProjectState(ctx.session.active_project_id);
  if (state && !state.isCompleted) {
    const mod = MODULES[state.nextModule!];
    await ctx.reply(
      `Продолжаем проект «${state.projectName}».\n` +
      `Вы остановились на: ${mod.emoji} ${mod.name}`,
      { 
        reply_markup: new InlineKeyboard()
          .text(`▶️ Продолжить`, mod.startCallback)
          .text('📊 Статус', 'nav:status'),
        ...getContextKeyboard(ctx) 
      }
    );
    return;
  }
}
```

---

## ЧАСТЬ 5: ОБНОВЛЁННЫЕ СООБЩЕНИЯ БОТА

### 5.1 /start (первый визит)

```
Привет! Я — AI бренд-студия Maks Martin.

Помогу создать бренд: стратегию, название, визуальный стиль 
и готовый документ для работы.

Обычно это занимает 30-40 минут.

[🚀 Новый проект]  [❓ Как это работает]
```

### 5.2 /start (есть проекты)

```
С возвращением!

У вас есть проект «{name}» — {статус}.

[▶️ Продолжить «{name}»]
[🚀 Новый проект]  [📂 Все проекты]
```

### 5.3 Статус проекта (обновлённый формат)

```
Проект: {name}

📋 Бриф — ✅ готов
🧬 Стратегия бренда — ✅ готова  
🏷 Нейминг — ⏳ в работе
🎨 Концепции — ⬜
🖼 Визуальный стиль — ⬜
📦 Финальный документ — ⬜

[▶️ Продолжить — Нейминг]
```

### 5.4 Сообщения при запуске модулей

| Модуль | Сообщение при запуске |
|--------|---------------------|
| 1 | "Расскажите о вашем проекте — что это за бизнес и чего вы хотите добиться?" |
| 2 | "🧬 Анализирую бриф и формирую стратегическую платформу бренда..." |
| 3 | "🏷 Разрабатываю варианты названий на основе стратегии..." |
| 4 | "🎨 Создаю концептуальные направления развития бренда..." |
| 5 | "🖼 Формирую визуальный стиль на основе выбранной концепции..." |
| 6 | "📦 Собираю все материалы в финальный документ..." |

### 5.5 Сообщения при переходе между модулями

```
✅ {Название модуля} — готово!

Следующий шаг — {emoji} {название следующего модуля}.

[▶️ Продолжить]  [📊 Статус]
```

### 5.6 Помощь (контекстная)

Помощь адаптируется к текущему состоянию:

**Нет проекта:**
```
Brand Studio создаёт бренд за 6 шагов:
📋 Бриф → 🧬 Стратегия → 🏷 Нейминг → 🎨 Концепции → 🖼 Визуал → 📦 Документ

Каждый шаг можно обсудить и доработать.

[🚀 Начать]
```

**Внутри модуля:**
```
Вы на этапе: {emoji} {название модуля}

Что можно сделать:
• Одобрить результат и перейти дальше
• Попросить доработать — напишите что изменить
• Вернуться на предыдущий шаг

Просто напишите что хотите изменить, или нажмите кнопку.
```

---

## ЧАСТЬ 6: ЗАЩИТА ОТ STALE CALLBACKS

```typescript
// middleware/staleCallback.ts

export async function staleCallbackGuard(ctx: BotContext, next: () => Promise<void>) {
  if (!ctx.callbackQuery?.data) return next();
  
  const data = ctx.callbackQuery.data;
  
  // Callbacks с artifactId — проверяем что артефакт актуален
  const artifactMatch = data.match(/:([0-9a-f-]{36})$/);
  if (artifactMatch) {
    const artifactId = artifactMatch[1];
    const artifact = await getArtifactById(artifactId);
    
    if (!artifact || artifact.status === 'superseded') {
      await ctx.answerCallbackQuery({ 
        text: 'Эта версия устарела. Используйте кнопки в последнем сообщении.',
        show_alert: true 
      });
      return;
    }
  }
  
  return next();
}
```

---

## ЧАСТЬ 7: ПОРЯДОК РЕАЛИЗАЦИИ (для Claude Code)

### Шаг 1: Память неймов (фикс повторов)
1. Добавить `getAllArtifactsOfType` в `db/artifacts.ts`
2. Добавить `getAllPreviousNames` и `extractNamesFromText` в `modules/naming.ts`
3. Обновить `buildNamingPrompt` — добавить блок ранее предложенных
4. Обновить `runNaming`, `handleNamingMore`, `handleNamingRevisionInput` — использовать полную историю
5. Обновить `NAMING_SYSTEM_PROMPT` — добавить инструкцию из NAMING_SKILL_v2.md

### Шаг 2: Единые названия модулей
1. Обновить `MODULES` в `utils/nextStep.ts` — все на русском
2. Обновить все сообщения при запуске модулей
3. Обновить `progressSummary` — русские названия + emoji
4. Обновить `MODULE_NAMES` в `navigation.ts` — русские названия

### Шаг 3: Глобальный text interceptor
1. Создать `src/handlers/textInterceptor.ts`
2. В `index.ts` в text router — вызвать interceptor ПЕРЕД проверкой `awaiting_input`
3. Interceptor проверяет: статус, проекты, помощь, назад, меню, стоп
4. Если interceptor не сработал — передать в обычный handler

### Шаг 4: Контекстная reply keyboard
1. Создать `IDLE_KEYBOARD`, `PROJECT_KEYBOARD`, `BRIEFING_KEYBOARD`
2. Создать `getContextKeyboard(ctx)` 
3. Добавить "🚀 Новый проект" в `IDLE_KEYBOARD` как reply button
4. Добавить "▶️ Продолжить" в `PROJECT_KEYBOARD`
5. Во всех reply — передавать `reply_markup: getContextKeyboard(ctx)`

### Шаг 5: Обработка текста как фидбэка
1. После text interceptor, если `awaiting_input` не установлен, но есть активный модуль
2. И текст не похож на команду — трактовать как ревизионный комментарий
3. Спросить: "Передать это как пожелание к доработке {модуля}?" + [Да] [Нет]

### Шаг 6: Stale callback guard
1. Создать `middleware/staleCallback.ts`
2. Добавить middleware в bot pipeline перед callback handlers
3. Для callback с artifactId — проверять что артефакт не superseded

### Шаг 7: Обновить /start
1. Если есть проекты — показать последний + кнопку продолжить
2. Если нет — показать приветствие + "Новый проект" + "Как это работает"

### Шаг 8: Обновить /help (контекстная)
1. Без проекта — общее описание
2. С проектом — текущий этап + что можно делать
3. Внутри модуля — конкретные действия для этого этапа

---

## ЧАСТЬ 8: ОБНОВЛЁННАЯ СТРУКТУРА ФАЙЛОВ

```
src/
├── index.ts                    # Точка входа (упрощённая)
├── types.ts                    # BotContext, SessionData  
├── session.ts                  # initialSession
├── redis.ts
│
├── state/                      # НОВОЕ: State management
│   └── machine.ts              # Типы состояний, переходы
│
├── handlers/
│   ├── textInterceptor.ts      # НОВОЕ: Глобальный interceptor
│   ├── navigation.ts           # Клавиатуры, /status, /help, /projects  
│   ├── navigation_helpers.ts
│   ├── newProject.ts
│   ├── myProjects.ts
│   ├── pdfUpload.ts
│   ├── figma.ts
│   ├── learn.ts
│   └── callbackRouter.ts       # НОВОЕ: Единый router для callbacks
│
├── modules/
│   ├── common.ts               # НОВОЕ: Общие паттерны модулей
│   ├── brandDna.ts
│   ├── naming.ts               # ОБНОВЛЕНО: + память неймов
│   ├── conceptDirection.ts
│   ├── visualIdentity.ts
│   └── deliverables.ts
│
├── ai/
│   ├── gateway.ts
│   └── claude.ts
│
├── db/
│   ├── schema.ts
│   ├── artifacts.ts            # ОБНОВЛЕНО: + getAllArtifactsOfType
│   ├── briefs.ts
│   ├── projects.ts
│   ├── users.ts
│   ├── queries.ts
│   ├── figmaRefs.ts
│   ├── moduleRuns.ts
│   └── index.ts
│
├── prompts/                    # НОВОЕ: Вынести промпты из модулей
│   ├── styleGuide.ts
│   ├── briefing.ts
│   ├── brandDna.ts
│   ├── naming.ts               # NAMING_SKILL встроен сюда
│   ├── concepts.ts
│   ├── visual.ts
│   └── deliverables.ts
│
├── middleware/
│   ├── errorHandler.ts
│   ├── sessionRecovery.ts
│   └── staleCallback.ts        # НОВОЕ
│
├── utils/
│   ├── nextStep.ts             # ОБНОВЛЕНО: русские названия
│   └── telegram.ts
│
└── integrations/
    └── figma.ts
```

---

## ЧАСТЬ 9: ПРОМПТ ДЛЯ CLAUDE CODE

Когда будешь вносить изменения через Claude Code, дай ему этот промпт:

```
Мне нужно внести серию изменений в Telegram-бот Brand Studio.
Делай изменения ПОСЛЕДОВАТЕЛЬНО, по одному шагу. После каждого — 
проверяй что TypeScript компилируется (npx tsc --noEmit).

Порядок:
1. В src/db/artifacts.ts — добавь функцию getAllArtifactsOfType
2. В src/modules/naming.ts — добавь кумулятивную память неймов  
3. В src/utils/nextStep.ts — обнови MODULES на русские названия
4. В src/handlers/navigation.ts — обнови MODULE_NAMES и клавиатуры
5. Создай src/handlers/textInterceptor.ts
6. Обнови text router в src/index.ts — добавь вызов interceptor
7. Создай src/middleware/staleCallback.ts
8. Обнови /start и /help

Не меняй несколько файлов одновременно. Один шаг — один коммит.
```

---

## ЧАСТЬ 10: КРИТЕРИИ ГОТОВНОСТИ

### Минимум (must have):
- [ ] Нейминг не повторяет ранее предложенные имена
- [ ] Все модули названы по-русски в интерфейсе
- [ ] Глобальные команды (статус, помощь, проекты) работают на любом этапе
- [ ] Текст "назад" на любом этапе — возвращает
- [ ] Stale callbacks не ломают бота
- [ ] /start показывает последний проект если есть

### Желательно (nice to have):
- [ ] Контекстная reply keyboard
- [ ] Текст трактуется как фидбэк на этапе обзора модуля
- [ ] Intent router через Claude API для неоднозначных сообщений
- [ ] Таймер паузы — при возврате через 24ч напоминание где остановились
