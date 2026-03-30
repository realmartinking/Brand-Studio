import { Keyboard, InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { getProjectById, getUserProjects } from "../db/projects";
import { getActiveBrief } from "../db/briefs";
import { getLatestArtifact } from "../db/artifacts";
import { findOrCreateUser } from "../db/users";
import {
  getProjectState,
  progressSummary,
  nextStepKeyboard,
  continueKeyboard,
  MODULES,
} from "../utils/nextStep";

// ── Persistent keyboard ───────────────────────────────────────────────────────

export const MAIN_KEYBOARD = new Keyboard()
  .text("📊 Статус")
  .text("📂 Проекты")
  .text("❓ Помощь")
  .resized()
  .persistent();

// ── Module status checker ─────────────────────────────────────────────────────

type ModuleStatus = "done" | "active" | "pending";

interface ModuleInfo {
  num: number;
  label: string;
  status: ModuleStatus;
}

async function getModuleStatuses(
  projectId: string,
  currentModule: number
): Promise<ModuleInfo[]> {
  const brief = await getActiveBrief(projectId);
  const dna = await getLatestArtifact(projectId, "brand_dna");
  const verbal = await getLatestArtifact(projectId, "verbal_system");
  const concept = await getLatestArtifact(projectId, "concept_direction");
  const visual = await getLatestArtifact(projectId, "visual_identity");
  const deliverable = await getLatestArtifact(projectId, "deliverable");

  const isDone = (
    check: boolean,
    moduleNum: number
  ): ModuleStatus => {
    if (check) return "done";
    if (moduleNum === currentModule) return "active";
    return "pending";
  };

  return [
    {
      num: 1,
      label: "Бриф",
      status: isDone(brief?.status === "complete", 1),
    },
    {
      num: 2,
      label: "Brand DNA",
      status: isDone(dna?.status === "approved", 2),
    },
    {
      num: 3,
      label: "Нейминг & Verbal",
      status: isDone(verbal?.status === "approved", 3),
    },
    {
      num: 4,
      label: "Концепции",
      status: isDone(concept?.status === "approved", 4),
    },
    {
      num: 5,
      label: "Visual Identity",
      status: isDone(visual?.status === "approved", 5),
    },
    {
      num: 6,
      label: "Упаковка",
      status: isDone(deliverable?.status === "approved", 6),
    },
  ];
}

function statusIcon(s: ModuleStatus): string {
  return s === "done" ? "✅" : s === "active" ? "⏳" : "⬜";
}

function statusLabel(s: ModuleStatus): string {
  return s === "done" ? "готов" : s === "active" ? "в работе" : "";
}

// ── /status ───────────────────────────────────────────────────────────────────

export async function handleStatus(ctx: BotContext) {
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
  const nextMod = state.nextModule ? MODULES[state.nextModule] : null;
  const statusLine = state.isCompleted
    ? "🎉 Проект завершён!"
    : nextMod
      ? `Текущий этап: *${nextMod.name}*`
      : "";

  await ctx.reply(
    `*Проект: ${state.projectName}*\n\n${progress}\n\n${statusLine}`,
    { parse_mode: "Markdown", reply_markup: nextStepKeyboard(state) }
  );
}

// ── /projects ─────────────────────────────────────────────────────────────────

export async function handleProjects(ctx: BotContext) {
  const telegramId = BigInt(ctx.from!.id);
  const userProjects = await getUserProjects(telegramId);

  if (userProjects.length === 0) {
    await ctx.reply("У вас пока нет проектов. Используй /start чтобы создать первый.");
    return;
  }

  const STATUS_LABELS: Record<string, string> = {
    draft: "📝 Черновик",
    briefing: "📋 Брифинг",
    in_progress: "⚙️ В работе",
    review: "👀 На проверке",
    completed: "✅ Завершён",
    archived: "🗄 Архив",
  };

  const lines = userProjects.map((p, i) => {
    const label = STATUS_LABELS[p.status] ?? p.status;
    const active = p.id === ctx.session.active_project_id ? " ◀ активный" : "";
    return `${i + 1}. *${p.name}* — ${label} (М${p.currentModule})${active}`;
  });

  await ctx.reply(
    `*Ваши проекты:*\n\n${lines.join("\n")}\n\nНапиши номер проекта чтобы переключиться.`,
    { parse_mode: "Markdown" }
  );

  ctx.session.awaiting_input = "project_switch";
  // Store project IDs ordered by index for selection
  ctx.session.module_state = userProjects.map((p) => p.id).join(",");
}

// ── /module [n] ───────────────────────────────────────────────────────────────

export async function handleModule(ctx: BotContext) {
  const arg = ctx.match as string | undefined;
  const num = arg ? parseInt(arg.trim(), 10) : NaN;

  if (isNaN(num) || num < 1 || num > 6) {
    await ctx.reply(
      "Укажи номер модуля от 1 до 6.\n_Пример: /module 3_",
      { parse_mode: "Markdown" }
    );
    return;
  }

  const projectId = ctx.session.active_project_id;
  if (!projectId) {
    await ctx.reply("Нет активного проекта. Создай через /start.");
    return;
  }

  const project = await getProjectById(projectId);
  if (!project) return;

  // Check that previous modules are done
  if (num > project.currentModule + 1) {
    await ctx.reply(
      `⚠️ Модуль ${num} недоступен. Сначала завершите модуль ${project.currentModule}.`
    );
    return;
  }

  ctx.session.awaiting_input = null;
  ctx.session.module_state = null;

  const MODULE_RUNNERS: Record<number, () => Promise<void>> = {
    1: async () => {
      const { startBriefingDialog } = await import("./navigation_helpers");
      await startBriefingDialog(ctx);
    },
    2: async () => {
      const { runBrandDna } = await import("../modules/brandDna");
      await runBrandDna(ctx);
    },
    3: async () => {
      const { runNaming } = await import("../modules/naming");
      await runNaming(ctx);
    },
    4: async () => {
      const { runConceptDirection } = await import("../modules/conceptDirection");
      await runConceptDirection(ctx);
    },
    5: async () => {
      const { runVisualIdentity } = await import("../modules/visualIdentity");
      await runVisualIdentity(ctx);
    },
    6: async () => {
      const { runDeliverables } = await import("../modules/deliverables");
      await runDeliverables(ctx);
    },
  };

  await MODULE_RUNNERS[num]();
}

// ── /restart ──────────────────────────────────────────────────────────────────

export async function handleRestart(ctx: BotContext) {
  const projectId = ctx.session.active_project_id;
  if (!projectId) {
    await ctx.reply("Нет активного проекта.");
    return;
  }

  const project = await getProjectById(projectId);
  if (!project) return;

  ctx.session.awaiting_input = null;
  ctx.session.module_state = null;

  await ctx.reply(`🔄 Перезапускаю Модуль ${project.currentModule}...`);
  await handleModule(ctx);
}

// ── /export ───────────────────────────────────────────────────────────────────

export async function handleExport(ctx: BotContext) {
  const projectId = ctx.session.active_project_id;
  if (!projectId) {
    await ctx.reply("Нет активного проекта.");
    return;
  }

  const deliverable = await getLatestArtifact(projectId, "deliverable");

  if (deliverable) {
    // Full report exists — download it
    const { handleDownloadAgain } = await import("../modules/deliverables");
    await handleDownloadAgain(ctx);
  } else {
    // Partial results — go to deliverables module
    ctx.session.current_module = 6;
    const { runDeliverables } = await import("../modules/deliverables");
    await runDeliverables(ctx);
  }
}

// ── /help ─────────────────────────────────────────────────────────────────────

export async function handleHelp(ctx: BotContext) {
  const projectId = ctx.session.active_project_id;

  if (projectId) {
    const state = await getProjectState(projectId);
    if (state) {
      const nextMod = state.nextModule ? MODULES[state.nextModule] : null;
      const stageLine = state.isCompleted
        ? "Все этапы завершены"
        : nextMod
          ? `Текущий этап: Модуль ${nextMod.num} — ${nextMod.name}`
          : "";

      const kb = new InlineKeyboard()
        .row();

      if (!state.isCompleted && nextMod) {
        kb.text(`▶️ Продолжить работу`, nextMod.startCallback).row();
      }
      kb.text("📊 Статус проекта", "nav:status")
        .text("📂 Другой проект", "my_projects")
        .row()
        .text("🚀 Новый проект", "new_project");

      await ctx.reply(
        `Вы работаете над проектом *${state.projectName}*\n` +
        `${stageLine}\n\nЧто можно сделать:`,
        { parse_mode: "Markdown", reply_markup: kb }
      );
      return;
    }
  }

  // No active project — show basic help
  const kb = new InlineKeyboard()
    .text("🚀 Новый проект", "new_project")
    .text("📂 Мои проекты", "my_projects");

  await ctx.reply(
    `*Brand Studio Bot*\n\nСоздаёт стратегию бренда за 6 шагов:\n` +
    `1 — Бриф → 2 — Brand DNA → 3 — Нейминг\n` +
    `4 — Концепция → 5 — Визуал → 6 — Brand Book\n\n` +
    `Начни с создания проекта:`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
}

// ── /continue ─────────────────────────────────────────────────────────────────

export async function handleContinue(ctx: BotContext) {
  const telegramId = BigInt(ctx.from!.id);
  const { getPersistedSession } = await import("../db/users");

  const persisted = await getPersistedSession(telegramId);
  if (!persisted) {
    await ctx.reply(
      "Активных проектов не найдено. Создайте новый через /start."
    );
    return;
  }

  const { project } = persisted;
  ctx.session.active_project_id = project.id;
  ctx.session.current_module = project.currentModule;
  ctx.session.awaiting_input = null;
  ctx.session.module_state = null;

  const STATUS_LABELS: Record<string, string> = {
    draft: "черновик",
    briefing: "брифинг",
    in_progress: "в работе",
    review: "на проверке",
    completed: "завершён",
    archived: "архив",
  };

  const MODULE_NAMES: Record<number, string> = {
    1: "Бриф",
    2: "Brand DNA",
    3: "Нейминг & Verbal",
    4: "Concept Direction",
    5: "Visual Identity",
    6: "Deliverables",
  };

  const statusLabel = STATUS_LABELS[project.status] ?? project.status;
  const moduleName = MODULE_NAMES[project.currentModule] ?? `Модуль ${project.currentModule}`;

  const { InlineKeyboard } = await import("grammy");
  const keyboard = new InlineKeyboard()
    .text(`▶️ Продолжить — ${moduleName}`, `module_resume:${project.currentModule}`)
    .row()
    .text("📊 Статус проекта", `status:${project.id}`);

  await ctx.reply(
    `*Найден активный проект:* ${project.name}\n` +
    `Статус: ${statusLabel} | Модуль ${project.currentModule}: ${moduleName}`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
}

// ── Project switch (after /projects) ─────────────────────────────────────────

export async function handleProjectSwitch(ctx: BotContext, input: string) {
  const ids = ctx.session.module_state?.split(",") ?? [];
  const num = parseInt(input.trim(), 10);

  if (isNaN(num) || num < 1 || num > ids.length) {
    await ctx.reply(`Введите число от 1 до ${ids.length}.`);
    return;
  }

  const projectId = ids[num - 1];
  const project = await getProjectById(projectId);
  if (!project) return;

  ctx.session.active_project_id = projectId;
  ctx.session.current_module = project.currentModule;
  ctx.session.awaiting_input = null;
  ctx.session.module_state = null;
  ctx.session.briefing_step = null;

  const state = await getProjectState(projectId);
  if (!state) return;

  const nextMod = state.nextModule ? MODULES[state.nextModule] : null;
  const context = state.isCompleted
    ? "Проект завершён."
    : nextMod
      ? `Продолжаем с Модуля ${nextMod.num}: *${nextMod.name}*`
      : "";

  await ctx.reply(
    `✅ Переключились на *${project.name}*\n${context}`,
    { parse_mode: "Markdown", reply_markup: continueKeyboard(state) }
  );
}
