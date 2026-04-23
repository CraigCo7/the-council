import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { logger } from "../logger.js";

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
 * Log token usage — surfaces cache hits so we can catch silent invalidators.
 */
export function logUsage(label: string, usage: Anthropic.Messages.Usage | undefined) {
  if (!usage) return;
  logger.info(
    {
      label,
      input: usage.input_tokens,
      output: usage.output_tokens,
      cache_read: usage.cache_read_input_tokens ?? 0,
      cache_create: usage.cache_creation_input_tokens ?? 0,
    },
    "llm usage",
  );
}
