import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { db } from "../db/sqlite.js";
import { toLocalISODateTime } from "../vault/time.js";

export const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

export const MODELS = {
  routine: config.anthropic.models.routine,
  brief: config.anthropic.models.brief,
  strategic: config.anthropic.models.strategic,
} as const;

export type ModelRole = keyof typeof MODELS;

/**
 * Sensible defaults per role. `strategic` uses Opus 4.7 with adaptive thinking.
 */
export function defaultsFor(role: ModelRole): {
  model: string;
  max_tokens: number;
  thinking?: { type: "adaptive" };
} {
  switch (role) {
    case "routine":
      return { model: MODELS.routine, max_tokens: 4000 };
    case "brief":
      return { model: MODELS.brief, max_tokens: 8000 };
    case "strategic":
      return { model: MODELS.strategic, max_tokens: 16000, thinking: { type: "adaptive" } };
  }
}

/**
 * Log token usage to the service log AND persist to SQLite for daily cost
 * aggregation. `model` is required because cost depends on it — without
 * it the daily cost cron can't price the call.
 */
export function logUsage(
  label: string,
  model: string,
  usage: Anthropic.Messages.Usage | undefined,
): void {
  if (!usage) return;

  const input = usage.input_tokens;
  const output = usage.output_tokens;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreate = usage.cache_creation_input_tokens ?? 0;

  logger.info(
    {
      label,
      model,
      input,
      output,
      cache_read: cacheRead,
      cache_create: cacheCreate,
    },
    "llm usage",
  );

  try {
    db()
      .prepare(
        `INSERT INTO usage_records
           (created_at, label, model, input_tokens, output_tokens, cache_read, cache_create)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(toLocalISODateTime(), label, model, input, output, cacheRead, cacheCreate);
  } catch (err) {
    // Persistence is best-effort — never fail the main API path because
    // of a logging side-effect.
    logger.error({ err, label }, "failed to persist usage record");
  }
}
