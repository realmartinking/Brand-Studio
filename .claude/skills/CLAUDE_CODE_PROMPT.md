# ЗАДАНИЕ ДЛЯ CLAUDE CODE — ПОЛНАЯ ПЕРЕСТРОЙКА НАВИГАЦИИ

Прочитай файлы в корне проекта: UX_RESTRUCTURE_SPEC.md, NAMING_SKILL_v2.md, NAVIGATION_MAP.md.
Прочитай весь src/ чтобы понять текущую архитектуру.

Сделай изменения ПОСЛЕДОВАТЕЛЬНО. После каждого шага: npx tsc --noEmit.
Если ошибка — исправь перед переходом к следующему шагу.

---

## ШАГ 1: Память неймов (src/db/artifacts.ts)

Добавь import { asc } из drizzle-orm.
Добавь функцию:
```typescript
export async function getAllArtifactsOfType(projectId: string, type: ArtifactType) {
  return db.query.artifacts.findMany({
    where: and(eq(artifacts.projectId, projectId), eq(artifacts.type, type)),
    orderBy: [asc(artifacts.version)],
  });
}
```

---

## ШАГ 2: Общий навигационный модуль (СОЗДАТЬ src/modules/moduleNav.ts)

Создай новый файл src/modules/moduleNav.ts со следующей логикой:

```typescript
import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { getLatestArtifact } from "../db/artifacts";
import { getActiveBrief } from "../db/briefs";
import { sendLongMessage } from "../utils/telegram";
import { getProjectState, MODULES, progressSummary, moduleJumpKeyboard } from "../utils/nextStep";

// Маппинг модулей к типам артефактов
const MODULE_ARTIFACT_TYPE: Record<number, string> = {
  2: "brand_dna",
  3: "verbal_system",
  4: "concept_direction",
  5: "visual_identity",
  6: "deliverable",
};

// Маппинг модулей к ключам данных в артефакте
const MODULE_DATA_KEY: Record<number, string[]> = {
  2: ["text"],
  3: ["naming", "verbal"],
  4: ["concepts", "selectedConcept"],
  5: ["text"],
  6: ["text"],
};

/**
 * Показать существующий результат модуля ИЛИ запустить генерацию.
 * Вызывается при навигации вперёд/назад.
 */
export async function showOrRunModule(ctx: BotContext, moduleNum: number) {
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  // Модуль 1 (бриф) — особый случай
  if (moduleNum === 1) {
    const brief = await getActiveBrief(projectId);
    if (brief?.summary) {
      const kb = new InlineKeyboard()
        .text("✅ Всё верно", "brief:approve")
        .text("✏️ Дополнить", "brief:amend")
        .row()
        .text("📄 Скачать", "brief:download")
        .text("📊 Статус", "nav:status");
      await sendLongMessage(ctx, `*📋 Бриф проекта*\n\n${brief.summary}`, { reply_markup: kb });
    } else {
      const { startBriefingDialog } = await import("../briefing/dialog");
      ctx.session.awaiting_input = "briefing";
      await startBriefingDialog(ctx);
    }
    return;
  }

  const artifactType = MODULE_ARTIFACT_TYPE[moduleNum];
  if (!artifactType) return;

  const artifact = await getLatestArtifact(projectId, artifactType as any);

  if (artifact) {
    // Показать существующий результат
    await showModuleResult(ctx, moduleNum, artifact);
  } else {
    // Запустить генерацию
    await runModuleByNum(ctx, moduleNum);
  }
}

/**
 * Показать результат модуля с контекстными кнопками навигации.
 */
async function showModuleResult(ctx: BotContext, moduleNum: number, artifact: any) {
  const projectId = ctx.session.active_project_id!;
  const data = artifact.data as Record<string, string>;
  const mod = MODULES[moduleNum];

  // Определить текст для показа
  let text = "";
  const dataKeys = MODULE_DATA_KEY[moduleNum] ?? ["text"];
  for (const key of dataKeys) {
    if (data[key]) {
      text = data[key];
      break;
    }
  }

  if (!text) {
    await ctx.reply(`Результат ${mod.name} не найден. Запускаю генерацию...`);
    await runModuleByNum(ctx, moduleNum);
    return;
  }

  // Проверить: есть ли артефакт СЛЕДУЮЩЕГО модуля?
  let hasNextArtifact = false;
  if (moduleNum < 6) {
    const nextType = MODULE_ARTIFACT_TYPE[moduleNum + 1];
    if (nextType) {
      const nextArtifact = await getLatestArtifact(projectId, nextType as any);
      hasNextArtifact = !!nextArtifact;
    }
  }

  // Построить клавиатуру
  const kb = buildContextKeyboard(moduleNum, artifact.id, artifact.status, hasNextArtifact);

  ctx.session.current_module = moduleNum;
  ctx.session.module_state = artifact.id;

  await sendLongMessage(ctx, `*${mod.emoji} ${mod.name}*\n\n${text}`);
  await ctx.reply("Что делаем?", { reply_markup: kb });
}

/**
 * Строит клавиатуру с учётом контекста: назад, вперёд, одобрить, доработать.
 */
function buildContextKeyboard(
  moduleNum: number, 
  artifactId: string, 
  status: string,
  hasNextArtifact: boolean
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const prevMod = moduleNum > 1 ? MODULES[moduleNum - 1] : null;
  const nextMod = moduleNum < 6 ? MODULES[moduleNum + 1] : null;

  // Ряд 1: основные действия
  if (status !== "approved") {
    kb.text("✅ Одобрить", `approve:${moduleNum}:${artifactId}`)
      .text("✏️ Доработать", `revise:${moduleNum}:${artifactId}`);
  } else if (hasNextArtifact && nextMod) {
    kb.text(`▶️ ${nextMod.emoji} ${nextMod.name}`, `goto:${moduleNum + 1}`);
  }

  // Ряд 2: навигация
  kb.row();
  if (prevMod) {
    kb.text(`↩️ ${prevMod.emoji} ${prevMod.name}`, `goto:${moduleNum - 1}`);
  }
  if (hasNextArtifact && nextMod && status !== "approved") {
    kb.text(`▶️ ${nextMod.emoji} ${nextMod.name}`, `goto:${moduleNum + 1}`);
  }

  // Ряд 3: статус
  kb.row().text("📊 Статус", "nav:status");

  return kb;
}

/**
 * Запустить генерацию модуля по номеру.
 */
async function runModuleByNum(ctx: BotContext, moduleNum: number) {
  switch (moduleNum) {
    case 1: {
      const { startBriefingDialog } = await import("../briefing/dialog");
      ctx.session.awaiting_input = "briefing";
      await startBriefingDialog(ctx);
      break;
    }
    case 2: {
      const { runBrandDna } = await import("./brandDna");
      await runBrandDna(ctx);
      break;
    }
    case 3: {
      const { runNaming } = await import("./naming");
      await runNaming(ctx);
      break;
    }
    case 4: {
      const { runConceptDirection } = await import("./conceptDirection");
      await runConceptDirection(ctx);
      break;
    }
    case 5: {
      const { runVisualIdentity } = await import("./visualIdentity");
      await runVisualIdentity(ctx);
      break;
    }
    case 6: {
      const { runDeliverables } = await import("./deliverables");
      await runDeliverables(ctx);
      break;
    }
  }
}

/**
 * Умное одобрение: если следующий модуль уже есть — показать, иначе запустить.
 */
export async function handleSmartApprove(ctx: BotContext, moduleNum: number, artifactId: string) {
  const { approveArtifact } = await import("../db/artifacts");
  const { updateCurrentModule } = await import("../db/projects");
  
  await approveArtifact(artifactId);

  const projectId = ctx.session.active_project_id;
  if (!projectId) return;

  const nextModuleNum = moduleNum + 1;
  if (nextModuleNum > 6) {
    // Проект завершён
    const { sendNextStep } = await import("../utils/nextStep");
    await sendNextStep(ctx, projectId, "🎉 *Проект завершён!*");
    return;
  }

  await updateCurrentModule(projectId, nextModuleNum);
  ctx.session.current_module = nextModuleNum;
  ctx.session.module_state = null;

  // Показать следующий модуль или запустить
  await showOrRunModule(ctx, nextModuleNum);
}

/**
 * Обновлённый статус с кнопками навигации к каждому модулю.
 */
export async function handleStatusWithNav(ctx: BotContext) {
  const projectId = ctx.session.active_project_id;
  if (!projectId) {
    const kb = new InlineKeyboard()
      .text("📂 Мои проекты", "my_projects")
      .text("🚀 Новый проект", "new_project");
    await ctx.reply("Нет активного проекта.", { reply_markup: kb });
    return;
  }

  const state = await getProjectState(projectId);
  if (!state) {
    await ctx.reply("Проект не найден.");
    return;
  }

  const progress = progressSummary(state);
  
  // Кнопки навигации к завершённым модулям
  const kb = new InlineKeyboard();
  
  for (const modNum of state.completedModules) {
    const mod = MODULES[modNum];
    kb.text(`${mod.emoji} ${mod.name}`, `goto:${modNum}`).row();
  }

  // Кнопка текущего модуля
  if (state.nextModule) {
    const mod = MODULES[state.nextModule];
    kb.text(`▶️ Продолжить: ${mod.emoji} ${mod.name}`, `goto:${state.nextModule}`).row();
  }

  kb.text("↩️ К проектам", "my_projects");

  const statusLine = state.isCompleted
    ? "🎉 Проект завершён!"
    : state.nextModule
      ? `Текущий этап: *${MODULES[state.nextModule].name}*`
      : "";

  await ctx.reply(
    `*Проект: ${state.projectName}*\n\n${progress}\n\n${statusLine}`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
}
```

---

## ШАГ 3: Антиповтор неймов (src/modules/naming.ts)

В начало файла добавь import:
```typescript
import { getAllArtifactsOfType } from "../db/artifacts";
```

Добавь три функции (ПЕРЕД buildNamingInput):

```typescript
function extractNamesFromText(text: string): string[] {
  const names: string[] = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim();
    if (name.length >= 2 && name.length <= 40 &&
        !name.startsWith("НАПРАВЛЕНИЕ") && !name.startsWith("Направление") &&
        !name.includes("ДЕСКРИПТОР") && !name.includes("СЛОГАН")) {
      names.push(name);
    }
  }
  return names;
}

async function getAllPreviousNames(projectId: string): Promise<string[]> {
  const allArtifacts = await getAllArtifactsOfType(projectId, "verbal_system");
  const allNames: string[] = [];
  for (const artifact of allArtifacts) {
    const data = artifact.data as Record<string, string> | null;
    const naming = data?.naming ?? "";
    if (naming) allNames.push(...extractNamesFromText(naming));
  }
  return [...new Set(allNames)];
}

function buildNamingSystemPrompt(previousNames: string[]): string {
  let prompt = NAMING_SYSTEM_PROMPT;
  if (previousNames.length > 0) {
    prompt += `\n\n---\nКРИТИЧЕСКОЕ ПРАВИЛО — ЗАПРЕТ ПОВТОРОВ:\nЭти названия УЖЕ были предложены. НЕ ПОВТОРЯЙ ни одно из них и их производные:\n`;
    prompt += previousNames.join(", ");
    prompt += `\nПредложи ПОЛНОСТЬЮ НОВЫЕ варианты. Смени типологию, язык, ассоциативный подход.`;
  }
  return prompt;
}
```

Обнови runNaming, handleNamingMore, handleNamingRevisionInput:
- Перед генерацией: `const previousNames = await getAllPreviousNames(projectId);`
- Вместо `NAMING_SYSTEM_PROMPT` используй `buildNamingSystemPrompt(previousNames)`
- В handleNamingMore УБЕРИ строку с "Предыдущие варианты (не повторяй их)" из userMessage — теперь это в system prompt

Обнови namingKeyboard — добавь ряд:
```typescript
.row()
.text("↩️ К стратегии", "goto:2")
.text("📊 Статус", "nav:status");
```

Добавь и экспортируй handleNamingBackToDna:
```typescript
export async function handleNamingBackToDna(ctx: BotContext) {
  await ctx.answerCallbackQuery();
  const { showOrRunModule } = await import("./moduleNav");
  await showOrRunModule(ctx, 2);
}
```

---

## ШАГ 4: Навигация в стратегии (src/modules/brandDna.ts)

Обнови dnaKeyboard — добавь кнопку статуса:
```typescript
function dnaKeyboard(artifactId: string) {
  return new InlineKeyboard()
    .text("✅ Одобрить", `dna:approve:${artifactId}`)
    .text("✏️ Доработать", `dna:revise:${artifactId}`)
    .row()
    .text("↩️ К брифу", "dna:back_to_brief")
    .text("📊 Статус", "nav:status");
}
```

Обнови handleDnaApprove — вместо жёсткого перехода к неймингу:
```typescript
export async function handleDnaApprove(ctx: BotContext, artifactId: string) {
  await ctx.answerCallbackQuery();
  await approveArtifact(artifactId);
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;
  await updateCurrentModule(projectId, 3);
  ctx.session.current_module = 3;
  // Показать существующий нейминг или запустить
  const { showOrRunModule } = await import("./moduleNav");
  await showOrRunModule(ctx, 3);
}
```

---

## ШАГ 5: Навигация в концепциях (src/modules/conceptDirection.ts)

Обнови conceptsKeyboard — добавь навигацию:
```typescript
function conceptsKeyboard() {
  return new InlineKeyboard()
    .text("⭐ Выбрать концепцию", "concept:select")
    .row()
    .text("🔄 Другие направления", "concept:more")
    .text("✏️ Доработать", "concept:revise")
    .row()
    .text("↩️ К неймингу", "goto:3")
    .text("📊 Статус", "nav:status");
}
```

Обнови selectedConceptKeyboard — добавь статус:
```typescript
function selectedConceptKeyboard(artifactId: string) {
  return new InlineKeyboard()
    .text("✅ Одобрить", `concept:approve:${artifactId}`)
    .text("✏️ Доработать", `concept:revise_selected:${artifactId}`)
    .row()
    .text("↩️ Назад к концепциям", "concept:back")
    .text("📊 Статус", "nav:status");
}
```

Обнови handleConceptApprove — умный переход:
```typescript
export async function handleConceptApprove(ctx: BotContext, artifactId: string) {
  await ctx.answerCallbackQuery();
  await approveArtifact(artifactId);
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;
  await updateCurrentModule(projectId, 5);
  ctx.session.current_module = 5;
  ctx.session.module_state = null;
  const { showOrRunModule } = await import("./moduleNav");
  await showOrRunModule(ctx, 5);
}
```

---

## ШАГ 6: Навигация в визуале (src/modules/visualIdentity.ts)

Обнови visualKeyboard — добавь статус:
```typescript
function visualKeyboard(artifactId: string) {
  return new InlineKeyboard()
    .text("✅ Одобрить", `visual:approve:${artifactId}`)
    .text("✏️ Доработать", `visual:revise:${artifactId}`)
    .row()
    .text("↩️ К концепциям", "goto:4")
    .text("📊 Статус", "nav:status");
}
```

Обнови handleVisualApprove — умный переход:
```typescript
export async function handleVisualApprove(ctx: BotContext, artifactId: string) {
  await ctx.answerCallbackQuery();
  await approveArtifact(artifactId);
  const projectId = ctx.session.active_project_id;
  if (!projectId) return;
  await updateCurrentModule(projectId, 6);
  ctx.session.current_module = 6;
  ctx.session.module_state = null;
  const { showOrRunModule } = await import("./moduleNav");
  await showOrRunModule(ctx, 6);
}
```

---

## ШАГ 7: Навигация в документе (src/modules/deliverables.ts)

Обнови все клавиатуры — добавь навигацию к визуалу:
В функцию runDeliverables, клавиатуру выбора формата:
```typescript
const keyboard = new InlineKeyboard()
  .text("📄 Полный отчёт", "deliver:full_report")
  .text("📋 Краткая сводка", "deliver:summary")
  .row()
  .text("↩️ К визуалу", "goto:5")
  .text("📊 Статус", "nav:status");
```

В afterFullReportKeyboard:
```typescript
function afterFullReportKeyboard() {
  return new InlineKeyboard()
    .text("📄 Скачать ещё раз", "deliver:download_again")
    .row()
    .text("↩️ К визуалу", "goto:5")
    .text("🚀 Новый проект", "new_project");
}
```

---

## ШАГ 8: Русские названия (src/utils/nextStep.ts)

Обнови MODULES:
```typescript
export const MODULES: Record<number, ModuleInfo> = {
  1: { num: 1, name: "Бриф",              emoji: "📋", startCallback: "module:1:start" },
  2: { num: 2, name: "Стратегия бренда",   emoji: "🧬", startCallback: "module:2:start" },
  3: { num: 3, name: "Нейминг",            emoji: "🏷", startCallback: "module:3:start" },
  4: { num: 4, name: "Концепции",          emoji: "🎨", startCallback: "module:4:start" },
  5: { num: 5, name: "Визуальный стиль",   emoji: "🖼", startCallback: "module:5:start" },
  6: { num: 6, name: "Финальный документ", emoji: "📦", startCallback: "module:6:start" },
};
```

Добавь `emoji: string` в интерфейс ModuleInfo.

Обнови progressSummary — используй emoji:
```typescript
const icon = done ? "✅" : active ? "⏳" : "⬜";
return `${icon} ${m.emoji} ${m.name}`;
```

Обнови nextStepKeyboard и continueKeyboard — добавь emoji в текст кнопок.

---

## ШАГ 9: Регистрация goto callback (src/index.ts)

Добавь в начало файла import:
```typescript
import { showOrRunModule, handleStatusWithNav } from "./modules/moduleNav";
```

Добавь callback handler (после секции "Module navigation"):
```typescript
// ── Universal module navigation ───────────────────────────────────────────────
bot.callbackQuery(/^goto:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const moduleNum = parseInt(ctx.match[1], 10);
  await showOrRunModule(ctx, moduleNum);
});
```

Замени handler nav:status на handleStatusWithNav:
```typescript
bot.callbackQuery("nav:status", async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleStatusWithNav(ctx);
});
```

И в handleStatus (команда /status) тоже вызывай handleStatusWithNav.

---

## ШАГ 10: Проверка

1. npx tsc --noEmit — должно скомпилироваться без ошибок
2. Проверь что все импорты корректны
3. Проверь что нет циклических зависимостей (moduleNav импортирует модули через dynamic import)

После всех шагов — git add . && git commit -m "feat: full navigation system + naming memory"
