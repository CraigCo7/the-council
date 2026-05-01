import { db } from "../db/sqlite.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { costBreakdown, knownModel, type CostBreakdown } from "./pricing.js";

/**
 * Today's date as YYYY-MM-DD in the operator's timezone. Used to bound the
 * SQL window for the daily report.
 */
function operatorTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: config.operator.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Group usage_records rows by (label, model) and sum tokens per group.
 * Returns one row per group, ordered by total cost descending so the
 * biggest spenders surface first in the log.
 */
type RawRow = {
  label: string;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_create: number;
};

export type CostLineItem = {
  label: string;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_create: number;
  cost: CostBreakdown;
};

export type CostReport = {
  date: string;            // YYYY-MM-DD in operator TZ
  totalUsd: number;        // sum of all line items
  totalCalls: number;
  totalTokens: number;     // input + output only (cache reads aren't "fresh" tokens)
  byLabel: CostLineItem[]; // sorted desc by cost
  unknownModels: string[]; // any model used today that's not in our price table
};

/**
 * Build the daily cost report. Always returns a structured object; emits
 * nothing to logs itself (caller decides what to do with it).
 */
export function buildDailyCostReport(date?: string): CostReport {
  const target = date ?? operatorTodayISO();
  // ISO datetimes from toLocalISODateTime() begin with YYYY-MM-DD; an
  // anchored prefix match catches every record from that calendar day.
  const rows = db()
    .prepare(
      `SELECT
         label,
         model,
         COUNT(*) as calls,
         SUM(input_tokens) as input_tokens,
         SUM(output_tokens) as output_tokens,
         SUM(cache_read) as cache_read,
         SUM(cache_create) as cache_create
       FROM usage_records
       WHERE created_at LIKE ? || '%'
       GROUP BY label, model`,
    )
    .all(target) as RawRow[];

  const byLabel: CostLineItem[] = rows.map((r) => ({
    label: r.label,
    model: r.model,
    calls: r.calls,
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
    cache_read: r.cache_read,
    cache_create: r.cache_create,
    cost: costBreakdown(r.model, {
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      cache_read: r.cache_read,
      cache_create: r.cache_create,
    }),
  }));

  byLabel.sort((a, b) => b.cost.total - a.cost.total);

  const totalUsd = byLabel.reduce((s, x) => s + x.cost.total, 0);
  const totalCalls = byLabel.reduce((s, x) => s + x.calls, 0);
  const totalTokens = byLabel.reduce((s, x) => s + x.input_tokens + x.output_tokens, 0);

  const seenUnknown = new Set<string>();
  for (const r of rows) {
    if (!knownModel(r.model)) seenUnknown.add(r.model);
  }

  return {
    date: target,
    totalUsd,
    totalCalls,
    totalTokens,
    byLabel,
    unknownModels: Array.from(seenUnknown),
  };
}

/**
 * Format the report as a human-scannable multi-line string. Used for the
 * structured log line and (optionally) channel delivery.
 */
export function formatCostReport(r: CostReport): string {
  const lines: string[] = [];
  lines.push(`Daily Anthropic spend — ${r.date}`);
  lines.push(`  total:  $${r.totalUsd.toFixed(4)}  (${r.totalCalls} calls, ${r.totalTokens.toLocaleString()} fresh tokens)`);
  if (r.byLabel.length === 0) {
    lines.push(`  no API calls recorded today`);
  } else {
    lines.push(`  breakdown (sorted by cost):`);
    for (const x of r.byLabel) {
      lines.push(
        `    ${x.label} (${x.model}): $${x.cost.total.toFixed(4)}` +
          ` — ${x.calls} call${x.calls === 1 ? "" : "s"},` +
          ` in/out ${x.input_tokens.toLocaleString()}/${x.output_tokens.toLocaleString()}` +
          (x.cache_read > 0 || x.cache_create > 0
            ? `, cache r/w ${x.cache_read.toLocaleString()}/${x.cache_create.toLocaleString()}`
            : ""),
      );
    }
  }
  if (r.unknownModels.length > 0) {
    lines.push(
      `  WARN: unknown models seen, priced as Sonnet 4.6 fallback: ${r.unknownModels.join(", ")}`,
    );
  }
  return lines.join("\n");
}

/**
 * Compute today's report, emit one structured log line + the human format.
 * Called by cron at 23:59 operator-local.
 */
export function emitDailyCostReport(): CostReport {
  const report = buildDailyCostReport();
  logger.info(
    {
      kind: "cost.daily",
      date: report.date,
      total_usd: Number(report.totalUsd.toFixed(6)),
      total_calls: report.totalCalls,
      total_tokens: report.totalTokens,
      by_label: report.byLabel.map((x) => ({
        label: x.label,
        model: x.model,
        calls: x.calls,
        usd: Number(x.cost.total.toFixed(6)),
      })),
      unknown_models: report.unknownModels,
    },
    formatCostReport(report),
  );
  return report;
}
