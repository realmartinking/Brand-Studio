import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { getLatestArtifact } from "../db/artifacts";
import { getActiveBrief } from "../db/briefs";
import { sendLongMessage } from "../utils/telegram";
import { getProjectState, MODULES, progressSummary } from "../utils/nextStep";

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

  const artifact = await getLatestArtifact(projectId, artifactType as Parameters<typeof getLatestArtifact>[1]);

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
async function showModuleResult(ctx: BotContext, moduleNum: number, artifact: Awaited<ReturnType<typeof getLatestArtifact>>) {
  const projectId = ctx.session.active_project_id!;
  const data = (artifact!.data as Record<string, string>);
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
      const nextArtifact = await getLatestArtifact(projectId, nextType as Parameters<typeof getLatestArtifact>[1]);
      hasNextArtifact = !!nextArtifact;
    }
  }

  // Построить клавиатуру
  const kb = buildContextKeyboard(moduleNum, artifact!.id, artifact!.status, hasNextArtifact);

  ctx.session.current_module = moduleNum;
  ctx.session.module_state = artifact!.id;

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
    const { sendNextStep } = await import("../utils/nextStep");
    await sendNextStep(ctx, projectId, "🎉 *Проект завершён!*");
    return;
  }

  await updateCurrentModule(projectId, nextModuleNum);
  ctx.session.current_module = nextModuleNum;
  ctx.session.module_state = null;

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
