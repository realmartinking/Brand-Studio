import { eq, desc } from "drizzle-orm";
import { db } from "./index";
import { users, projects } from "./schema";

export async function findOrCreateUser(params: {
  telegramId: bigint;
  displayName: string | null;
}) {
  const existing = await db.query.users.findFirst({
    where: eq(users.telegramId, params.telegramId),
  });

  if (existing) return existing;

  const [created] = await db
    .insert(users)
    .values({
      telegramId: params.telegramId,
      displayName: params.displayName,
      role: "client",
    })
    .returning();

  return created;
}

export async function updateUserActiveProject(
  telegramId: bigint,
  projectId: string | null
) {
  await db
    .update(users)
    .set({ activeProjectId: projectId })
    .where(eq(users.telegramId, telegramId));
}

/**
 * Returns the user's persisted active project (for session recovery).
 * Falls back to the most recent non-completed project.
 */
export async function getPersistedSession(telegramId: bigint) {
  const user = await db.query.users.findFirst({
    where: eq(users.telegramId, telegramId),
  });

  if (!user) return null;

  // Prefer explicitly saved active project
  if (user.activeProjectId) {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, user.activeProjectId),
    });
    if (project) return { userId: user.id, project };
  }

  // Fall back to most recent active project
  const project = await db.query.projects.findFirst({
    where: eq(projects.userId, user.id),
    orderBy: [desc(projects.updatedAt)],
  });

  return project ? { userId: user.id, project } : null;
}
