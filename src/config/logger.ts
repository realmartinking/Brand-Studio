/**
 * Minimal structured logger.
 *
 * Interface-compatible with pino, so we can swap in later without touching call sites.
 * For now — uses console under the hood but emits structured JSON in production and
 * readable lines in dev.
 *
 * Usage:
 *   import { logger } from "../config/logger";
 *   const log = logger.child({ mod: "brandDna" });
 *   log.info({ projectId }, "starting generation");
 *   log.error({ err }, "claude call failed");
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const CURRENT_LEVEL: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ??
  (process.env.NODE_ENV === "production" ? "info" : "debug");

const IS_PROD = process.env.NODE_ENV === "production";

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[CURRENT_LEVEL];
}

function emit(level: LogLevel, bindings: Record<string, unknown>, obj: object, msg?: string) {
  if (!shouldLog(level)) return;

  const merged: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    ...bindings,
    ...obj,
  };
  if (msg) merged.msg = msg;

  if (IS_PROD) {
    // JSON for log aggregators (Datadog, Loki, CloudWatch).
    process.stdout.write(JSON.stringify(merged) + "\n");
  } else {
    // Human-readable for dev terminal.
    const tag = bindings.mod ? `[${bindings.mod}]` : "";
    const line = `${merged.time} ${level.toUpperCase()} ${tag} ${msg ?? ""}`;
    const rest = { ...obj };
    // Keep the line short; dump extra fields only if non-trivial.
    if (Object.keys(rest).length > 0) {
      console.log(line, rest);
    } else {
      console.log(line);
    }
  }
}

export interface Logger {
  debug(obj: object, msg?: string): void;
  debug(msg: string): void;
  info(obj: object, msg?: string): void;
  info(msg: string): void;
  warn(obj: object, msg?: string): void;
  warn(msg: string): void;
  error(obj: object, msg?: string): void;
  error(msg: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

function createLogger(bindings: Record<string, unknown> = {}): Logger {
  const make = (level: LogLevel) =>
    (objOrMsg: object | string, maybeMsg?: string) => {
      if (typeof objOrMsg === "string") {
        emit(level, bindings, {}, objOrMsg);
      } else {
        emit(level, bindings, objOrMsg, maybeMsg);
      }
    };

  return {
    debug: make("debug"),
    info: make("info"),
    warn: make("warn"),
    error: make("error"),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

export const logger = createLogger();
