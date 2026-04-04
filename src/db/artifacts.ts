import { eq, desc, asc, and } from "drizzle-orm";
import { db } from "./index";
import { artifacts } from "./schema";

type ArtifactType =
  | "brief"
  | "brand_dna"
  | "verbal_system"
  | "concept_direction"
  | "visual_identity"
  | "deliverable";

export async function saveArtifact(params: {
  moduleRunId: string;
  projectId: string;
  type: ArtifactType;
  name: string;
  data: Record<string, unknown>;
  version?: number;
}) {
  // Supersede previous versions of same type
  await db
    .update(artifacts)
    .set({ status: "superseded" })
    .where(
      and(
        eq(artifacts.projectId, params.projectId),
        eq(artifacts.type, params.type)
      )
    );

  const [artifact] = await db
    .insert(artifacts)
    .values({
      moduleRunId: params.moduleRunId,
      projectId: params.projectId,
      type: params.type,
      name: params.name,
      data: params.data,
      version: params.version ?? 1,
      status: "draft",
    })
    .returning();

  return artifact;
}

export async function getLatestArtifact(projectId: string, type: ArtifactType) {
  return db.query.artifacts.findFirst({
    where: and(eq(artifacts.projectId, projectId), eq(artifacts.type, type)),
    orderBy: [desc(artifacts.version)],
  });
}

export async function getApprovedArtifact(projectId: string, type: ArtifactType) {
  return db.query.artifacts.findFirst({
    where: and(
      eq(artifacts.projectId, projectId),
      eq(artifacts.type, type),
      eq(artifacts.status, "approved")
    ),
    orderBy: [desc(artifacts.version)],
  });
}

export async function getAllArtifactsOfType(projectId: string, type: ArtifactType) {
  return db.query.artifacts.findMany({
    where: and(eq(artifacts.projectId, projectId), eq(artifacts.type, type)),
    orderBy: [asc(artifacts.version)],
  });
}

export async function approveArtifact(id: string) {
  await db
    .update(artifacts)
    .set({ status: "approved" })
    .where(eq(artifacts.id, id));
}
