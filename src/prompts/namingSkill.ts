import fs from "fs";
import path from "path";

/**
 * Naming skill is stored in NAMING_SKILL.md alongside this file.
 * It's copied into dist/prompts/ by the build step (see package.json "build").
 *
 * Single source of truth: the .md file. No inline fallback — if the file
 * is missing at runtime, that's a deploy bug and we want it to surface loudly.
 */

let cached: string | null = null;

export function getNamingSkill(): string {
  if (cached !== null) return cached;

  const mdPath = path.join(__dirname, "NAMING_SKILL.md");
  try {
    cached = fs.readFileSync(mdPath, "utf-8");
  } catch (err) {
    throw new Error(
      `Missing NAMING_SKILL.md at ${mdPath}. ` +
        `In dev, ensure src/prompts/NAMING_SKILL.md exists. ` +
        `In prod, the build step must copy prompts/*.md into dist/. ` +
        `Underlying error: ${(err as Error).message}`
    );
  }

  return cached;
}
