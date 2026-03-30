import { eq, desc, and } from "drizzle-orm";
import { db } from "./index";
import { moduleRuns } from "./schema";

export async function getLatestModuleRun(projectId: string, moduleNum: number) {
  return db.query.moduleRuns.findFirst({
    where: and(
      eq(moduleRuns.projectId, projectId),
      eq(moduleRuns.moduleNum, moduleNum)
    ),
    orderBy: [desc(moduleRuns.createdAt)],
  });
}
