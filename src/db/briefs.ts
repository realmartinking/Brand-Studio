import { eq, desc } from "drizzle-orm";
import { db } from "./index";
import { briefs } from "./schema";
import type { DialogMessage } from "../ai/claude";

export async function getActiveBrief(projectId: string) {
  return db.query.briefs.findFirst({
    where: eq(briefs.projectId, projectId),
    orderBy: [desc(briefs.createdAt)],
  });
}

export async function getDialog(projectId: string): Promise<DialogMessage[]> {
  const brief = await getActiveBrief(projectId);
  if (!brief) return [];
  const data = (brief.data as Record<string, unknown>) ?? {};
  return (data.dialog as DialogMessage[]) ?? [];
}

export async function appendDialogMessage(
  projectId: string,
  message: DialogMessage
) {
  const brief = await getActiveBrief(projectId);
  if (!brief) return;

  const data = (brief.data as Record<string, unknown>) ?? {};
  const dialog = (data.dialog as DialogMessage[]) ?? [];

  await db
    .update(briefs)
    .set({ data: { ...data, dialog: [...dialog, message] } })
    .where(eq(briefs.id, brief.id));
}

export async function saveStructuredBrief(
  projectId: string,
  structured: string
) {
  const brief = await getActiveBrief(projectId);
  if (!brief) return;

  const data = (brief.data as Record<string, unknown>) ?? {};
  await db
    .update(briefs)
    .set({ data: { ...data, structured }, summary: structured })
    .where(eq(briefs.id, brief.id));
}

export async function completeBrief(projectId: string) {
  const brief = await getActiveBrief(projectId);
  if (!brief) return;

  await db
    .update(briefs)
    .set({ status: "complete" })
    .where(eq(briefs.id, brief.id));
}

export interface UploadedDocument {
  filename: string;
  analysis: string;
  addedAt: string;
}

export async function appendUploadedDocument(
  projectId: string,
  doc: UploadedDocument
) {
  const brief = await getActiveBrief(projectId);
  if (!brief) return;

  const data = (brief.data as Record<string, unknown>) ?? {};
  const existing = (data.uploaded_documents as UploadedDocument[]) ?? [];

  await db
    .update(briefs)
    .set({ data: { ...data, uploaded_documents: [...existing, doc] } })
    .where(eq(briefs.id, brief.id));
}

export async function getUploadedDocumentsContext(
  projectId: string
): Promise<string> {
  const brief = await getActiveBrief(projectId);
  if (!brief) return "";

  const data = (brief.data as Record<string, unknown>) ?? {};
  const docs = (data.uploaded_documents as UploadedDocument[]) ?? [];
  if (docs.length === 0) return "";

  return docs
    .map((d, i) => `=== Загруженный документ ${i + 1}: ${d.filename} ===\n${d.analysis}`)
    .join("\n\n");
}
