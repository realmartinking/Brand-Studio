import { eq, asc, sql } from "drizzle-orm";
import { db } from "./index";
import { figmaReferences } from "./schema";

export async function saveFigmaReference(params: {
  projectId: string;
  figmaFileKey: string;
  pageId: string;
  pageName: string;
  content: string;
}) {
  const [ref] = await db
    .insert(figmaReferences)
    .values(params)
    .returning();
  return ref;
}

export async function getFigmaReferences(projectId: string) {
  return db
    .select()
    .from(figmaReferences)
    .where(eq(figmaReferences.projectId, projectId))
    .orderBy(asc(figmaReferences.createdAt));
}

export async function deleteFigmaReferences(projectId: string): Promise<number> {
  const result = await db
    .delete(figmaReferences)
    .where(eq(figmaReferences.projectId, projectId))
    .returning({ id: figmaReferences.id });
  return result.length;
}
