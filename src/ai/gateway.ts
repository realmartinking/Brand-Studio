import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { db } from "../db/index";
import { moduleRuns } from "../db/schema";

// ── Clients ──────────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Models & pricing ─────────────────────────────────────────────────────────

const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const GPT_MODEL = "gpt-4o";

const PRICING = {
  claude: { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  gpt: { input: 2.5 / 1_000_000, output: 10.0 / 1_000_000 },
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GenerateOptions {
  projectId?: string;
  moduleNum?: number;
  maxTokens?: number;
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

function calcCost(
  provider: "claude" | "gpt",
  inputTokens: number,
  outputTokens: number
): number {
  const p = PRICING[provider];
  return inputTokens * p.input + outputTokens * p.output;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveModuleRun(
  result: RunResult,
  systemPrompt: string,
  userMessage: string,
  status: "completed" | "failed",
  opts: GenerateOptions
) {
  if (!opts.projectId) return;

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
}

function log(result: RunResult, status: "ok" | "error") {
  const icon = status === "ok" ? "✓" : "✗";
  console.log(
    `[AI ${icon}] provider=${result.provider} model=${result.model} ` +
    `tokens=${result.inputTokens}+${result.outputTokens} ` +
    `cost=$${result.costUsd.toFixed(6)} duration=${result.durationMs}ms`
  );
}

// ── Raw providers ─────────────────────────────────────────────────────────────

async function callClaude(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 2048
): Promise<RunResult> {
  const start = Date.now();
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const durationMs = Date.now() - start;

  return {
    text: (response.content[0] as Anthropic.TextBlock).text,
    provider: "claude",
    model: CLAUDE_MODEL,
    inputTokens,
    outputTokens,
    costUsd: calcCost("claude", inputTokens, outputTokens),
    durationMs,
  };
}

async function callGPT(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 2048
): Promise<RunResult> {
  const start = Date.now();
  const response = await openai.chat.completions.create({
    model: GPT_MODEL,
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
    model: GPT_MODEL,
    inputTokens,
    outputTokens,
    costUsd: calcCost("gpt", inputTokens, outputTokens),
    durationMs,
  };
}

// ── Retry + fallback wrapper ───────────────────────────────────────────────────

const RETRIES = 2;
const RETRY_DELAY_MS = 2000;

async function withRetry(
  fn: () => Promise<RunResult>
): Promise<RunResult> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      console.warn(`[AI] attempt ${attempt + 1} failed:`, (err as Error).message);
      if (attempt < RETRIES) await sleep(RETRY_DELAY_MS);
    }
  }

  throw lastError;
}

async function generate(
  primary: () => Promise<RunResult>,
  fallback: () => Promise<RunResult>,
  systemPrompt: string,
  userMessage: string,
  opts: GenerateOptions
): Promise<string> {
  let result: RunResult;

  try {
    result = await withRetry(primary);
    log(result, "ok");
    await saveModuleRun(result, systemPrompt, userMessage, "completed", opts);
  } catch (primaryErr) {
    console.warn("[AI] primary failed, switching to fallback...");

    try {
      result = await withRetry(fallback);
      log(result, "ok");
      await saveModuleRun(result, systemPrompt, userMessage, "completed", opts);
    } catch (fallbackErr) {
      const stub: RunResult = {
        text: "",
        provider: "claude",
        model: CLAUDE_MODEL,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        durationMs: 0,
      };
      log(stub, "error");
      await saveModuleRun(stub, systemPrompt, userMessage, "failed", opts);
      throw fallbackErr;
    }
  }

  return result.text;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function generateWithClaude(
  systemPrompt: string,
  userMessage: string,
  opts: GenerateOptions = {}
): Promise<string> {
  return generate(
    () => callClaude(systemPrompt, userMessage, opts.maxTokens),
    () => callGPT(systemPrompt, userMessage, opts.maxTokens),
    systemPrompt,
    userMessage,
    opts
  );
}

export async function generateWithGPT(
  systemPrompt: string,
  userMessage: string,
  opts: GenerateOptions = {}
): Promise<string> {
  return generate(
    () => callGPT(systemPrompt, userMessage, opts.maxTokens),
    () => callClaude(systemPrompt, userMessage, opts.maxTokens),
    systemPrompt,
    userMessage,
    opts
  );
}
