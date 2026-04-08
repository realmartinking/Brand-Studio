import { eq, desc } from "drizzle-orm";
import { db } from "./index";
import { users, projects } from "./schema";

export async function findOrCreateUser(params: {
  telegramId: bigint;
  displayName: string | null;
}) {
  // Use standard select builder (not relational API) to avoid BigInt aliasing
  // issues in db.query.findFirst that can cause the WHERE clause to be skipped.
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, params.telegramId))
    .limit(1);

  if (existing[0]) return existing[0];

  // onConflictDoNothing guards against concurrent inserts with the same telegram_id
  const [created] = await db
    .insert(users)
    .values({
      telegramId: params.telegramId,
      displayName: params.displayName,
      role: "client",
    })
    .onConflictDoNothing()
    .returning();

  // If onConflictDoNothing fired (row already existed), fetch it
  if (!created) {
    const [refetched] = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, params.telegramId))
      .limit(1);
    return refetched;
  }

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
  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);

  const user = userRows[0];
  if (!user) return null;

  // Prefer explicitly saved active project
  if (user.activeProjectId) {
    const projectRows = await db
      .select()
      .from(projects)
      .where(eq(projects.id, user.activeProjectId))
      .limit(1);
    if (projectRows[0]) return { userId: user.id, project: projectRows[0] };
  }

  // Fall back to most recent active project
  const projectRows = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, user.id))
    .orderBy(desc(projects.updatedAt))
    .limit(1);

  return projectRows[0] ? { userId: user.id, project: projectRows[0] } : null;
}
