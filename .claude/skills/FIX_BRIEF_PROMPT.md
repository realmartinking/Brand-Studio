# ПОЧИНКА: Бриф без summary ломает все последующие модули

## ПРОБЛЕМА

Когда пользователь загружает PDF через doc:use, данные сохраняются в `briefs.data.uploaded_documents`, но `briefs.summary` остаётся NULL. Все модули (Brand DNA, Naming и далее) читают `brief.summary` — получают "Бриф не найден" — и AI начинает с нуля.

## КОРНЕВАЯ ПРИЧИНА

В `src/handlers/pdfUpload.ts` → `handleDocUse`:
- Вызывает `appendUploadedDocument()` — сохраняет анализ PDF в `data.uploaded_documents`
- Вызывает `completeBrief()` — ставит `status = "complete"` 
- НО НЕ создаёт `summary` из uploaded_documents

В `src/briefing/dialog.ts` → `handleSummarize`:
- Вызывает `generateStructuredBrief()` → сохраняет результат в `summary`
- Но этот путь работает только если был ДИАЛОГ

Результат: если пользователь загрузил PDF и пропустил диалог — summary пустой → все модули сломаны.

## ИСПРАВЛЕНИЕ

### Шаг 1: src/handlers/pdfUpload.ts — handleDocUse

После `await completeBrief(projectId);` добавь генерацию summary из uploaded_documents:

```typescript
// Генерировать summary из загруженных документов если его ещё нет
const brief = await getActiveBrief(projectId);
if (brief && !brief.summary) {
  const { getUploadedDocumentsContext } = await import("../db/briefs");
  const docsContext = await getUploadedDocumentsContext(projectId);
  
  if (docsContext) {
    // Собрать summary из документов
    const summaryText = await generateWithClaude(
      "Ты — brand-стратег. На основе предоставленных материалов создай структурированный бриф проекта. " +
      "Формат: Суть проекта, Продукт/Услуга, Целевая аудитория, Рынок и конкуренты, Ценности, Цели. " +
      "Используй ТОЛЬКО информацию из документов. Если чего-то не хватает — отметь как '[не указано]'.",
      docsContext,
      { projectId, moduleNum: 1, maxTokens: 2000 }
    );
    
    await saveStructuredBrief(projectId, summaryText);
  }
}
```

Добавь необходимые импорты вверху файла:
```typescript
import { generateWithClaude } from "../ai/gateway";
import { saveStructuredBrief } from "../db/briefs";
```

### Шаг 2: src/handlers/pdfUpload.ts — handleDocBriefSkip

Та же проблема. После `await completeBrief(projectId);` добавь ту же логику генерации summary.

### Шаг 3: src/modules/brandDna.ts — getBriefContent

Сделай fallback на uploaded_documents если summary пустой:

Найди функцию `getBriefContent` и обнови:

```typescript
async function getBriefContent(projectId: string): Promise<string> {
  const brief = await getActiveBrief(projectId);
  if (!brief) throw new Error("Brief not found");

  const data = (brief.data as Record<string, unknown>) ?? {};
  
  // Приоритет 1: структурированный summary
  if (brief.summary) return brief.summary;
  if (data.structured) return data.structured as string;

  // Приоритет 2: данные из загруженных документов
  const { getUploadedDocumentsContext } = await import("../db/briefs");
  const docsContext = await getUploadedDocumentsContext(projectId);
  if (docsContext) return docsContext;

  // Приоритет 3: диалог
  const dialog = (data.dialog as Array<{ role: string; content: string }>) ?? [];
  if (dialog.length > 0) {
    return dialog.map((m) => `${m.role === "user" ? "Клиент" : "Стратег"}: ${m.content}`).join("\n\n");
  }

  return "Бриф не заполнен. Работай с теми данными что есть.";
}
```

### Шаг 4: src/modules/naming.ts — buildNamingInput

Аналогичный fallback:

```typescript
async function buildNamingInput(projectId: string): Promise<string> {
  const brief = await getActiveBrief(projectId);
  const dnaArtifact =
    (await getApprovedArtifact(projectId, "brand_dna")) ??
    (await getLatestArtifact(projectId, "brand_dna"));

  // Brief: попробовать summary, потом uploaded_documents, потом dialog
  let briefText = brief?.summary ?? "";
  if (!briefText) {
    const { getUploadedDocumentsContext } = await import("../db/briefs");
    briefText = await getUploadedDocumentsContext(projectId) || "";
  }
  if (!briefText) {
    const data = (brief?.data as Record<string, unknown>) ?? {};
    const dialog = (data.dialog as Array<{ role: string; content: string }>) ?? [];
    briefText = dialog.map((m) => `${m.role === "user" ? "Клиент" : "Стратег"}: ${m.content}`).join("\n\n");
  }
  if (!briefText) briefText = "Бриф не найден";

  const dnaText = (dnaArtifact?.data as Record<string, string> | null)?.text ?? "Brand DNA не найдена";

  console.log("[naming] Brand DNA found:", dnaText.substring(0, 100));
  console.log("[naming] Brief found:", briefText.substring(0, 100));

  return `БРИФ ПРОЕКТА:\n${briefText}\n\n---\nУТВЕРЖДЁННАЯ BRAND DNA (не пересоздавать, использовать как основу):\n${dnaText}`;
}
```

### Шаг 5: Логика "мало данных" в system prompts

В src/modules/brandDna.ts, в самый КОНЕЦ SYSTEM_PROMPT добавь:

```
ВАЖНО О ПОЛНОТЕ ДАННЫХ:
- Если бриф содержит достаточно информации — работай сразу, не задавай вопросов
- Если данных мало но они есть — предупреди одним предложением что можно дополнить, но СРАЗУ создай платформу из того что есть. НЕ останавливай процесс.
- Только если данных КРИТИЧЕСКИ мало (вообще ничего кроме названия) — задай 2-3 ключевых вопроса: что за бизнес, для кого, чем отличается. И жди ответа.
```

В src/modules/naming.ts, в NAMING_SYSTEM_PROMPT добавь в начало:

```
ОБЯЗАТЕЛЬНО: Тебе предоставлены бриф и Brand DNA. Используй ИХ. Не проси клиента повторно описать бренд. Не задавай уточняющих вопросов — генерируй названия из того что есть.
```

### Шаг 6: Проверка

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Cannot find name" | grep -v "vitest" | grep -v "'lib' compiler" | grep -v "'any' type"
```

0 ошибок → git add -A && git commit -m "fix: brief summary from PDF, data continuity between modules" && git push origin main
