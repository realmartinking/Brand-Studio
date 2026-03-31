import { eq } from "drizzle-orm";
import { db } from "./index";
import { users } from "./schema";

/**
 * Fetches the user's role directly from PostgreSQL.
 * Always reads from DB — never from Redis session — so role changes
 * take effect immediately without requiring the user to /start again.
 */
export async function getUserRole(
  telegramId: bigint
): Promise<"client" | "manager" | "admin" | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.telegramId, telegramId),
    columns: { role: true },
  });
  return user?.role ?? null;
}

export function isPrivileged(role: string | null): boolean {
  return role === "manager" || role === "admin";
}
