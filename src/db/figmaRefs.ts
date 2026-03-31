import { eq, asc, count } from "drizzle-orm";
import { db } from "./index";
import { figmaReferences } from "./schema";

export async function saveFigmaReference(params: {
  projectId: string;
  figmaFileKey: string;
  pageId: string;
  pageName: string;
  content: string;
  source?: "figma" | "pdf";
}) {
  const [ref] = await db
    .insert(figmaReferences)
    .values({
      projectId: params.projectId,
      figmaFileKey: params.figmaFileKey,
      pageId: params.pageId,
      pageName: params.pageName,
      content: params.content,
      source: params.source ?? "figma",
    })
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

export async function countFigmaReferences(projectId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(figmaReferences)
    .where(eq(figmaReferences.projectId, projectId));
  return row?.value ?? 0;
}

export async function deleteFigmaReferences(projectId: string): Promise<number> {
  const result = await db
    .delete(figmaReferences)
    .where(eq(figmaReferences.projectId, projectId))
    .returning({ id: figmaReferences.id });
  return result.length;
}
