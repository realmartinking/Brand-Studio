import { eq } from "drizzle-orm";
import { db } from "./index";
import { projects, briefs, users } from "./schema";

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
  const user = await db.query.users.findFirst({
    where: eq(users.telegramId, telegramId),
  });

  if (!user) return [];

  return db.query.projects.findMany({
    where: eq(projects.userId, user.id),
    orderBy: (p, { desc }) => [desc(p.createdAt)],
  });
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

export async function getStyleGuide(projectId: string): Promise<string | null> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { styleGuide: true },
  });
  return project?.styleGuide ?? null;
}
