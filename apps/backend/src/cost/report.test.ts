import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db/sqlite.js";
import { buildDailyCostReport, formatCostReport } from "./report.js";

const DAY = "2026-04-30";
const DAY_OTHER = "2026-04-29";

function insertUsage(args: {
  date: string;
  label: string;
  model: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheCreate?: number;
}): void {
  db()
    .prepare(
      `INSERT INTO usage_records
         (created_at, label, model, input_tokens, output_tokens, cache_read, cache_create)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `${args.date}T12:00:00+08:00`,
      args.label,
      args.model,
      args.input ?? 0,
      args.output ?? 0,
      args.cacheRead ?? 0,
      args.cacheCreate ?? 0,
    );
}

describe("buildDailyCostReport", () => {
  beforeEach(() => {
    db().prepare(`DELETE FROM usage_records`).run();
  });

  it("returns a zeroed report when no records exist for the day", () => {
    const r = buildDailyCostReport(DAY);
    expect(r.date).toBe(DAY);
    expect(r.totalUsd).toBe(0);
    expect(r.totalCalls).toBe(0);
    expect(r.byLabel).toEqual([]);
    expect(r.unknownModels).toEqual([]);
  });

  it("aggregates calls by (label, model) and sums tokens", () => {
    insertUsage({ date: DAY, label: "chief-of-staff:iter0", model: "claude-sonnet-4-6", input: 1000, output: 200 });
    insertUsage({ date: DAY, label: "chief-of-staff:iter0", model: "claude-sonnet-4-6", input: 2000, output: 300 });
    insertUsage({ date: DAY, label: "daily-brief", model: "claude-sonnet-4-6", input: 5000, output: 500 });

    const r = buildDailyCostReport(DAY);
    expect(r.byLabel).toHaveLength(2);
    const cos = r.byLabel.find((x) => x.label === "chief-of-staff:iter0")!;
    expect(cos.calls).toBe(2);
    expect(cos.input_tokens).toBe(3000);
    expect(cos.output_tokens).toBe(500);
  });

  it("sorts line items by cost descending", () => {
    // Strategic Analyst on Opus is pricier per token even with fewer tokens.
    insertUsage({ date: DAY, label: "chief-of-staff:iter0", model: "claude-sonnet-4-6", input: 1000, output: 100 });
    insertUsage({ date: DAY, label: "strategic-analyst", model: "claude-opus-4-7", input: 800, output: 600 });

    const r = buildDailyCostReport(DAY);
    expect(r.byLabel[0].label).toBe("strategic-analyst");
    expect(r.byLabel[1].label).toBe("chief-of-staff:iter0");
    expect(r.byLabel[0].cost.total).toBeGreaterThan(r.byLabel[1].cost.total);
  });

  it("ignores records from other days", () => {
    insertUsage({ date: DAY, label: "today-call", model: "claude-sonnet-4-6", input: 1000 });
    insertUsage({ date: DAY_OTHER, label: "yesterday-call", model: "claude-sonnet-4-6", input: 5000 });

    const r = buildDailyCostReport(DAY);
    expect(r.byLabel).toHaveLength(1);
    expect(r.byLabel[0].label).toBe("today-call");
  });

  it("totalUsd matches the sum of line item costs", () => {
    insertUsage({ date: DAY, label: "a", model: "claude-sonnet-4-6", input: 1000, output: 100 });
    insertUsage({ date: DAY, label: "b", model: "claude-opus-4-7", input: 500, output: 200 });

    const r = buildDailyCostReport(DAY);
    const sumOfLines = r.byLabel.reduce((s, x) => s + x.cost.total, 0);
    expect(r.totalUsd).toBeCloseTo(sumOfLines, 10);
  });

  it("flags unknown models so the operator knows the price might be wrong", () => {
    insertUsage({ date: DAY, label: "weird", model: "claude-fictional-99", input: 1000 });

    const r = buildDailyCostReport(DAY);
    expect(r.unknownModels).toContain("claude-fictional-99");
  });

  it("does not flag known models", () => {
    insertUsage({ date: DAY, label: "legit", model: "claude-sonnet-4-6", input: 1000 });

    const r = buildDailyCostReport(DAY);
    expect(r.unknownModels).toEqual([]);
  });
});

describe("formatCostReport", () => {
  beforeEach(() => {
    db().prepare(`DELETE FROM usage_records`).run();
  });

  it("includes the date, total, and per-label lines", () => {
    insertUsage({ date: DAY, label: "chief-of-staff:iter0", model: "claude-sonnet-4-6", input: 1000, output: 200 });
    const r = buildDailyCostReport(DAY);
    const text = formatCostReport(r);
    expect(text).toContain(DAY);
    expect(text).toContain("total:");
    expect(text).toContain("chief-of-staff:iter0");
    expect(text).toContain("claude-sonnet-4-6");
  });

  it("says 'no API calls recorded' for an empty day", () => {
    const r = buildDailyCostReport(DAY);
    expect(formatCostReport(r)).toContain("no API calls recorded today");
  });
});
