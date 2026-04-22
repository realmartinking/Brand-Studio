/**
 * Centralized AI model configuration.
 *
 * Three-tier strategy:
 * - classifier (Haiku 4.5)  — routing, intent classification, extraction
 * - default   (Sonnet 4.6)  — dialog, generation, most production inference
 * - hero      (Opus 4.7)    — deliverables, high-stakes long-form generation
 *
 * Pricing (per 1M tokens, April 2026):
 *   Haiku 4.5 : $1 / $5
 *   Sonnet 4.6: $3 / $15
 *   Opus 4.7  : $5 / $25
 *
 * Override via environment variables if you need to pin a specific version.
 */

export const MODELS = {
  claude: {
    classifier: process.env.CLAUDE_CLASSIFIER_MODEL ?? "claude-haiku-4-5-20251001",
    default: process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6",
    hero: process.env.CLAUDE_HERO_MODEL ?? "claude-opus-4-7",
  },
  openai: {
    default: process.env.GPT_MODEL ?? "gpt-4o",
  },
} as const;

/**
 * Pricing used by gateway.ts for cost tracking.
 * Input/output cost per TOKEN (divide per-million prices by 1_000_000).
 */
export const PRICING = {
  "claude-haiku-4-5-20251001": { input: 1.0 / 1_000_000, output: 5.0 / 1_000_000 },
  "claude-sonnet-4-6": { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  "claude-opus-4-7": { input: 5.0 / 1_000_000, output: 25.0 / 1_000_000 },
  "gpt-4o": { input: 2.5 / 1_000_000, output: 10.0 / 1_000_000 },
} as const;

export function priceFor(model: string): { input: number; output: number } {
  return (
    (PRICING as Record<string, { input: number; output: number }>)[model] ?? {
      // Fallback: Sonnet pricing for unknown models, so we don't silently lose cost tracking.
      input: 3.0 / 1_000_000,
      output: 15.0 / 1_000_000,
    }
  );
}
