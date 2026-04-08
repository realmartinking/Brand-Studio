import { eq } from "drizzle-orm";
import postgres from "postgres";
import { db } from "./index";
import { users, studioSettings } from "./schema";

const rawSql = postgres(process.env.DATABASE_URL!);

export async function getUserRole(
  telegramId: bigint
): Promise<"client" | "manager" | "admin" | null> {
  const rows = await rawSql`SELECT role::text as role FROM users WHERE telegram_id = ${telegramId.toString()} LIMIT 1`;
  return (rows[0]?.role as "client" | "manager" | "admin") ?? null;
}

export function isPrivileged(role: string | null): boolean {
  return role === "manager" || role === "admin";
}

export async function getStudioSetting(key: string): Promise<string | null> {
  const row = await db.query.studioSettings.findFirst({
    where: eq(studioSettings.key, key),
    columns: { value: true },
  });
  return row?.value ?? null;
}

export async function setStudioSetting(key: string, value: string): Promise<void> {
  await db
    .insert(studioSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: studioSettings.key,
      set: { value, updatedAt: new Date() },
    });
}
