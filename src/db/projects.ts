import { eq, desc, inArray } from "drizzle-orm";
import { db } from "./index";
import { projects, briefs, users, moduleRuns, artifacts, figmaReferences } from "./schema";

export async function createProject(params: {
  userId: string;
  name: string;
}) {
  const [project] = await db
    .insert(projects)
    .values({
      userId: params.userId,
      name: params.name,
      status: "briefing",
    })
    .returning();

  const [brief] = await db
    .insert(briefs)
    .values({
      projectId: project.id,
      status: "in_progress",
      data: {},
    })
    .returning();

  return { project, brief };
}

export async function getUserProjects(telegramId: bigint) {
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);

  const user = userRows[0];
  if (!user) return [];

  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, user.id))
    .orderBy(desc(projects.createdAt));
}

export async function getProjectById(id: string) {
  return db.query.projects.findFirst({
    where: eq(projects.id, id),
  });
}

export async function updateCurrentModule(projectId: string, moduleNum: number) {
  await db
    .update(projects)
    .set({ currentModule: moduleNum, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

export async function updateProjectStatus(
  projectId: string,
  status: "draft" | "briefing" | "in_progress" | "review" | "completed" | "archived"
) {
  await db
    .update(projects)
    .set({ status, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

export async function updateStyleGuide(projectId: string, styleGuide: string) {
  await db
    .update(projects)
    .set({ styleGuide, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

export async function deleteProject(projectId: string): Promise<void> {
  // Delete in FK dependency order: artifacts → moduleRuns → figmaRefs → briefs → project
  await db.delete(artifacts).where(eq(artifacts.projectId, projectId));
  await db.delete(moduleRuns).where(eq(moduleRuns.projectId, projectId));
  await db.delete(figmaReferences).where(eq(figmaReferences.projectId, projectId));
  await db.delete(briefs).where(eq(briefs.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
}

export async function deleteAllUserProjects(userId: string): Promise<number> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.userId, userId));

  if (rows.length === 0) return 0;

  const ids = rows.map((r) => r.id);
  await db.delete(artifacts).where(inArray(artifacts.projectId, ids));
  await db.delete(moduleRuns).where(inArray(moduleRuns.projectId, ids));
  await db.delete(figmaReferences).where(inArray(figmaReferences.projectId, ids));
  await db.delete(briefs).where(inArray(briefs.projectId, ids));
  await db.delete(projects).where(eq(projects.userId, userId));

  return ids.length;
}

export async function findProjectByName(userId: string, name: string) {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId));

  const lower = name.toLowerCase().trim();
  return rows.find((p) => p.name.toLowerCase().includes(lower)) ?? null;
}

export async function getStyleGuide(projectId: string): Promise<string | null> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { styleGuide: true },
  });
  return project?.styleGuide ?? null;
}
