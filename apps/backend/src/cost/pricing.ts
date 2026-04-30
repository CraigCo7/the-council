/**
 * Anthropic API pricing per million tokens.
 *
 * Source: https://platform.claude.com/docs/en/about-claude/models/overview
 *
 * Cache pricing follows Anthropic's published multipliers:
 * - Cache READ:  ~10% of base input rate
 * - Cache WRITE: 1.25× base input rate (5-minute TTL — the default)
 *
 * If we ever switch to 1-hour TTL caching, cache write would be 2× base.
 * We don't currently use 1-hour TTL anywhere, so the 1.25× factor is
 * accurate for our workload.
 *
 * Models we don't recognize fall back to Sonnet 4.6 pricing — middle of the
 * road, conservative estimate, won't grossly under-report cost.
 */
export type PricePerMTok = { input: number; output: number };

export const PRICING: Record<string, PricePerMTok> = {
  "claude-opus-4-7": { input: 5.0, output: 25.0 },
  "claude-opus-4-6": { input: 5.0, output: 25.0 },
  "claude-opus-4-5": { input: 5.0, output: 25.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

const FALLBACK_MODEL = "claude-sonnet-4-6";
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export type UsageBreakdown = {
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_create: number;
};

/**
 * Compute USD cost for a single call's token usage.
 * Returns total cost; for per-component costs, use `costBreakdown`.
 */
export function costFor(model: string, usage: UsageBreakdown): number {
  const b = costBreakdown(model, usage);
  return b.total;
}

export type CostBreakdown = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
};

export function costBreakdown(model: string, usage: UsageBreakdown): CostBreakdown {
  const p = PRICING[model] ?? PRICING[FALLBACK_MODEL];
  const input = (usage.input_tokens * p.input) / 1_000_000;
  const output = (usage.output_tokens * p.output) / 1_000_000;
  const cacheRead = (usage.cache_read * p.input * CACHE_READ_MULTIPLIER) / 1_000_000;
  const cacheWrite = (usage.cache_create * p.input * CACHE_WRITE_MULTIPLIER) / 1_000_000;
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

export function knownModel(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(PRICING, model);
}
