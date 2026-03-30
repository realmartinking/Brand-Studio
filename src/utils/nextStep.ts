import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { getProjectById } from "../db/projects";
import { getActiveBrief } from "../db/briefs";
import { getLatestArtifact } from "../db/artifacts";

// ── Module metadata ───────────────────────────────────────────────────────────

export interface ModuleInfo {
  num: number;
  name: string;
  startCallback: string;
}

export const MODULES: Record<number, ModuleInfo> = {
  1: { num: 1, name: "Бриф",               startCallback: "module:1:start" },
  2: { num: 2, name: "Brand DNA",           startCallback: "module:2:start" },
  3: { num: 3, name: "Нейминг & Verbal",    startCallback: "module:3:start" },
  4: { num: 4, name: "Concept Direction",   startCallback: "module:4:start" },
  5: { num: 5, name: "Visual Identity",     startCallback: "module:5:start" },
  6: { num: 6, name: "Brand Book",          startCallback: "module:6:start" },
};

// ── Project state ─────────────────────────────────────────────────────────────

export interface ProjectState {
  projectId: string;
  projectName: string;
  currentModule: number;
  completedModules: number[];
  nextModule: number | null; // null = project done
  isCompleted: boolean;
}

export async function getProjectState(projectId: string): Promise<ProjectState | null> {
  const project = await getProjectById(projectId);
  if (!project) return null;

  const brief     = await getActiveBrief(projectId);
  const dna       = await getLatestArtifact(projectId, "brand_dna");
  const verbal    = await getLatestArtifact(projectId, "verbal_system");
  const concept   = await getLatestArtifact(projectId, "concept_direction");
  const visual    = await getLatestArtifact(projectId, "visual_identity");
  const delivered = await getLatestArtifact(projectId, "deliverable");

  const done = [
    brief?.status === "complete"      && 1,
    dna?.status === "approved"        && 2,
    verbal?.status === "approved"     && 3,
    concept?.status === "approved"    && 4,
    visual?.status === "approved"     && 5,
    (delivered?.status === "approved" || project.status === "completed") && 6,
  ].filter((n): n is number => !!n);

  const isCompleted = done.includes(6);
  const nextModule = isCompleted
    ? null
    : ([1, 2, 3, 4, 5, 6].find((n) => !done.includes(n)) ?? null);

  return {
    projectId,
    projectName: project.name,
    currentModule: project.currentModule,
    completedModules: done,
    nextModule,
    isCompleted,
  };
}

// ── Keyboard builders ─────────────────────────────────────────────────────────

export function nextStepKeyboard(state: ProjectState): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (state.isCompleted) {
    kb.text("📦 Скачать результаты", "deliver:download_again").row();
    kb.text("🚀 Новый проект", "new_project");
  } else if (state.nextModule) {
    const mod = MODULES[state.nextModule];
    kb.text(`▶️ Запустить ${mod.name}`, mod.startCallback).row();
    kb.text("📊 Статус", "nav:status").text("↩️ К проектам", "my_projects");
  }

  return kb;
}

export function continueKeyboard(state: ProjectState): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (state.isCompleted) {
    kb.text("📦 Скачать Brand Book", "deliver:download_again").row();
    kb.text("🚀 Новый проект", "new_project");
  } else if (state.nextModule) {
    const mod = MODULES[state.nextModule];
    kb.text(`▶️ Продолжить — ${mod.name}`, mod.startCallback).row();
    kb.text("📊 Статус", "nav:status");
  }

  return kb;
}

// ── Summary line ──────────────────────────────────────────────────────────────

export function progressSummary(state: ProjectState): string {
  const lines = Object.values(MODULES).map((m) => {
    const done = state.completedModules.includes(m.num);
    const active = !done && m.num === state.nextModule;
    const icon = done ? "✅" : active ? "⏳" : "⬜";
    return `${icon} М${m.num}: ${m.name}`;
  });
  return lines.join("\n");
}

// ── Send next step message ────────────────────────────────────────────────────

export async function sendNextStep(
  ctx: BotContext,
  projectId: string,
  customMessage?: string
) {
  const state = await getProjectState(projectId);
  if (!state) return;

  let message: string;

  if (customMessage) {
    message = customMessage;
  } else if (state.isCompleted) {
    message = `🎉 Проект *${state.projectName}* полностью завершён!`;
  } else if (state.nextModule) {
    const done = state.completedModules.length;
    const mod = MODULES[state.nextModule];
    message =
      done === 0
        ? `Начинаем работу над *${state.projectName}*`
        : `Модули 1–${done} завершены. Следующий шаг — *${mod.name}*`;
  } else {
    return;
  }

  await ctx.reply(message, {
    parse_mode: "Markdown",
    reply_markup: nextStepKeyboard(state),
  });
}
