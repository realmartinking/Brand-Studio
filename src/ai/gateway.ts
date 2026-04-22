import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { db } from "../db/index";
import { moduleRuns } from "../db/schema";
import { getStyleGuide } from "../db/projects";
import { getUploadedDocumentsContext } from "../db/briefs";
import { MODELS, priceFor } from "../config/models";
import { logger } from "../config/logger";

// ── Clients ──────────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

// OpenAI client is lazy: constructed on first use so missing
// OPENAI_API_KEY doesn't crash the app at import time (e.g. in CI
// where GPT fallback isn't exercised). The existing isValidOpenAiKey
// guard in callGPT() still throws a clear error when GPT is actually
// needed without a valid key.
let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

const log = logger.child({ mod: "ai.gateway" });

// ── Types ─────────────────────────────────────────────────────────────────────

export type ModelTier = "classifier" | "default" | "hero";

export interface GenerateOptions {
  projectId?: string;
  moduleNum?: number;
  maxTokens?: number;
  /**
   * Model tier:
   *  - "classifier" → Haiku 4.5  ($1/$5)  for routing, intent, short JSON
   *  - "default"    → Sonnet 4.6 ($3/$15) for generation, dialog, most work
   *  - "hero"       → Opus 4.7   ($5/$25) for deliverables, long-form
   * Default: "default".
   */
  tier?: ModelTier;
  /** If true, returns empty string instead of throwing on API failure (used by non-critical classifiers). */
  softFail?: boolean;
}

export interface DialogMessage {
  role: "user" | "assistant";
  content: string;
}

interface RunResult {
  text: string;
  provider: "claude" | "gpt";
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(model);
  return inputTokens * p.input + outputTokens * p.output;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveModel(tier: ModelTier): string {
  return MODELS.claude[tier];
}

async function saveModuleRun(
  result: RunResult,
  systemPrompt: string,
  userMessage: string,
  status: "completed" | "failed",
  opts: GenerateOptions
) {
  if (!opts.projectId) return;

  try {
    await db.insert(moduleRuns).values({
      projectId: opts.projectId,
      moduleNum: opts.moduleNum ?? 0,
      status,
      aiProvider: result.provider,
      model: result.model,
      input: { system: systemPrompt, user: userMessage },
      output: { text: result.text },
      tokensUsed: result.inputTokens + result.outputTokens,
      costUsd: String(result.costUsd.toFixed(6)),
      durationMs: result.durationMs,
    });
  } catch (err) {
    // Never let analytics failures break the main flow.
    log.error({ err: (err as Error).message, projectId: opts.projectId }, "failed to save module_run");
  }
}

// ── Raw providers ─────────────────────────────────────────────────────────────

interface ClaudeInput {
  system: string;
  userMessage?: string;
  messages?: DialogMessage[];
  maxTokens: number;
  model: string;
}

async function callClaude(input: ClaudeInput): Promise<RunResult> {
  const start = Date.now();

  const messages: DialogMessage[] =
    input.messages ?? [{ role: "user", content: input.userMessage ?? "" }];

  const response = await anthropic.messages.create({
    model: input.model,
    max_tokens: input.maxTokens,
    system: input.system,
    messages,
  });

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const durationMs = Date.now() - start;
  const text = (response.content[0] as Anthropic.TextBlock).text;

  return {
    text,
    provider: "claude",
    model: input.model,
    inputTokens,
    outputTokens,
    costUsd: calcCost(input.model, inputTokens, outputTokens),
    durationMs,
  };
}

function isValidOpenAiKey(key: string | undefined): key is string {
  return !!key && !key.includes("your_") && key.startsWith("sk-");
}

async function callGPT(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 2048
): Promise<RunResult> {
  if (!isValidOpenAiKey(process.env.OPENAI_API_KEY)) {
    throw new Error("[AI] OpenAI API key is missing or invalid — skipping GPT fallback");
  }

  const start = Date.now();
  const model = MODELS.openai.default;
  const response = await getOpenAI().chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  const inputTokens = response.usage?.prompt_tokens ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;
  const durationMs = Date.now() - start;

  return {
    text: response.choices[0].message.content ?? "",
    provider: "gpt",
    model,
    inputTokens,
    outputTokens,
    costUsd: calcCost(model, inputTokens, outputTokens),
    durationMs,
  };
}

// ── Retry with exponential backoff + retryable classification ─────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function isRetryable(err: unknown): boolean {
  const e = err as { status?: number; name?: string; code?: string };
  if (e?.status === 429) return true;
  if (e?.status && e.status >= 500 && e.status < 600) return true;
  if (e?.code === "ETIMEDOUT" || e?.code === "ECONNRESET" || e?.code === "ENOTFOUND") return true;
  if (e?.name === "AbortError") return true;
  return false;
}

async function withRetry(fn: () => Promise<RunResult>): Promise<RunResult> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const retryable = isRetryable(err);
      log.warn(
        { attempt: attempt + 1, retryable, err: (err as Error).message },
        "ai call failed"
      );
      if (!retryable || attempt === MAX_RETRIES) break;
      const delay = BASE_DELAY_MS * 2 ** attempt * (0.7 + Math.random() * 0.6);
      await sleep(delay);
    }
  }

  throw lastError;
}

// ── Core generator ────────────────────────────────────────────────────────────

async function generate(
  primary: () => Promise<RunResult>,
  fallback: () => Promise<RunResult>,
  systemPrompt: string,
  userMessage: string,
  opts: GenerateOptions
): Promise<string> {
  if (!userMessage || userMessage.trim().length === 0) {
    throw new Error("Cannot call AI with empty user message. Brief data is missing.");
  }

  let result: RunResult;

  try {
    result = await withRetry(primary);
    log.info(
      {
        provider: result.provider,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: Number(result.costUsd.toFixed(6)),
        durationMs: result.durationMs,
        projectId: opts.projectId,
        moduleNum: opts.moduleNum,
      },
      "ai call ok"
    );
    await saveModuleRun(result, systemPrompt, userMessage, "completed", opts);
  } catch (primaryErr) {
    log.warn({ err: (primaryErr as Error).message }, "primary failed, trying fallback");

    try {
      result = await withRetry(fallback);
      log.info(
        {
          provider: result.provider,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: Number(result.costUsd.toFixed(6)),
          durationMs: result.durationMs,
          fallback: true,
        },
        "ai fallback ok"
      );
      await saveModuleRun(result, systemPrompt, userMessage, "completed", opts);
    } catch (fallbackErr) {
      log.error(
        {
          primaryErr: (primaryErr as Error).message,
          fallbackErr: (fallbackErr as Error).message,
          projectId: opts.projectId,
        },
        "both primary and fallback failed"
      );

      const stub: RunResult = {
        text: "",
        provider: "claude",
        model: "unknown",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        durationMs: 0,
      };
      await saveModuleRun(stub, systemPrompt, userMessage, "failed", opts);

      if (opts.softFail) return "";
      throw fallbackErr;
    }
  }

  return result.text;
}

// ── Style Guide / uploaded docs injector ──────────────────────────────────────

async function withStyleGuide(systemPrompt: string, projectId?: string): Promise<string> {
  if (!projectId) return systemPrompt;

  let result = systemPrompt;

  const styleGuide = await getStyleGuide(projectId);
  if (styleGuide) {
    result += `\n\n---\nSTYLE GUIDE СТУДИИ (обязательно учитывай при генерации):\n${styleGuide}`;
  }

  const uploadedDocs = await getUploadedDocumentsContext(projectId);
  if (uploadedDocs) {
    result += `\n\n---\nДОПОЛНИТЕЛЬНЫЕ МАТЕРИАЛЫ ИЗ ЗАГРУЖЕННЫХ ДОКУМЕНТОВ (используй как контекст):\n${uploadedDocs}`;
  }

  return result;
}

// ── Revision prefix ───────────────────────────────────────────────────────────

export const REVISION_SYSTEM_PREFIX =
  "Ты получил комментарий от клиента к текущему результату. " +
  "Твоя задача — ДОПОЛНИТЬ и УЛУЧШИТЬ существующий результат, а НЕ переписывать его целиком. " +
  "Сохрани всё что клиент не критиковал. Внеси только те изменения которые клиент попросил. " +
  "Если клиент говорит «добавить» или «дополнить» — добавь к существующему, не заменяй.\n\n";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate text via Claude with GPT fallback.
 * Default tier: "default" (Sonnet 4.6).
 */
export async function generateWithClaude(
  systemPrompt: string,
  userMessage: string,
  opts: GenerateOptions = {}
): Promise<string> {
  const enrichedSystem = await withStyleGuide(systemPrompt, opts.projectId);
  const model = resolveModel(opts.tier ?? "default");
  const maxTokens = opts.maxTokens ?? 2048;

  return generate(
    () => callClaude({ system: enrichedSystem, userMessage, maxTokens, model }),
    () => callGPT(enrichedSystem, userMessage, maxTokens),
    enrichedSystem,
    userMessage,
    opts
  );
}

/**
 * Generate via GPT first with Claude fallback.
 */
export async function generateWithGPT(
  systemPrompt: string,
  userMessage: string,
  opts: GenerateOptions = {}
): Promise<string> {
  const enrichedSystem = await withStyleGuide(systemPrompt, opts.projectId);
  const model = resolveModel(opts.tier ?? "default");
  const maxTokens = opts.maxTokens ?? 2048;

  return generate(
    () => callGPT(enrichedSystem, userMessage, maxTokens),
    () => callClaude({ system: enrichedSystem, userMessage, maxTokens, model }),
    enrichedSystem,
    userMessage,
    opts
  );
}

/**
 * Vision / multimodal generation.
 *
 * Input content blocks: text + images (base64).
 * Used for PDF page OCR, Figma screenshot analysis, mood-board parsing.
 *
 * No GPT fallback — vision formats differ between providers; we'd end up with
 * divergent outputs. Retry Claude with backoff instead.
 */
export interface VisionImage {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  /** Base64-encoded image bytes, without the data:*;base64, prefix. */
  base64: string;
}

export async function generateVisionWithClaude(
  systemPrompt: string,
  text: string,
  images: VisionImage[],
  opts: GenerateOptions = {}
): Promise<string> {
  if (images.length === 0 && !text.trim()) {
    throw new Error("generateVisionWithClaude called with no images and no text.");
  }

  const enrichedSystem = await withStyleGuide(systemPrompt, opts.projectId);
  const model = resolveModel(opts.tier ?? "default");
  const maxTokens = opts.maxTokens ?? 2048;

  const content: Array<
    | { type: "image"; source: { type: "base64"; media_type: VisionImage["mediaType"]; data: string } }
    | { type: "text"; text: string }
  > = images.map((img) => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 },
  }));
  if (text.trim()) content.push({ type: "text" as const, text });

  const start = Date.now();

  const doCall = async (): Promise<RunResult> => {
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system: enrichedSystem,
      messages: [{ role: "user", content }],
    });
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    return {
      text: (response.content[0] as Anthropic.TextBlock).text,
      provider: "claude",
      model,
      inputTokens,
      outputTokens,
      costUsd: calcCost(model, inputTokens, outputTokens),
      durationMs: Date.now() - start,
    };
  };

  try {
    const result = await withRetry(doCall);
    log.info(
      {
        provider: result.provider,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: Number(result.costUsd.toFixed(6)),
        durationMs: result.durationMs,
        images: images.length,
        projectId: opts.projectId,
      },
      "vision ai call ok"
    );
    await saveModuleRun(result, enrichedSystem, text || `[${images.length} image(s)]`, "completed", opts);
    return result.text;
  } catch (err) {
    log.error(
      { err: (err as Error).message, images: images.length, projectId: opts.projectId },
      "vision ai call failed"
    );
    if (opts.softFail) return "";
    throw err;
  }
}

/**
 * Multi-turn dialog — used by briefing.
 * No GPT fallback: dialog state would desync between providers.
 */
export async function generateDialogWithClaude(
  systemPrompt: string,
  messages: DialogMessage[],
  opts: GenerateOptions = {}
): Promise<string> {
  if (messages.length === 0) {
    throw new Error("Cannot call AI with empty message list.");
  }

  const enrichedSystem = await withStyleGuide(systemPrompt, opts.projectId);
  const model = resolveModel(opts.tier ?? "default");
  const maxTokens = opts.maxTokens ?? 2048;

  const result = await withRetry(() =>
    callClaude({ system: enrichedSystem, messages, maxTokens, model })
  );

  log.info(
    {
      provider: result.provider,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: Number(result.costUsd.toFixed(6)),
      durationMs: result.durationMs,
      projectId: opts.projectId,
    },
    "dialog ai call ok"
  );
  const lastUser = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
  await saveModuleRun(result, enrichedSystem, lastUser, "completed", opts);

  return result.text;
}
