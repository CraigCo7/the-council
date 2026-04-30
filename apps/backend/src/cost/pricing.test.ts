import { describe, it, expect } from "vitest";
import { costFor, costBreakdown, knownModel, PRICING } from "./pricing.js";

describe("pricing table", () => {
  it("includes every model the app routes to today", () => {
    expect(PRICING["claude-sonnet-4-6"]).toBeDefined();
    expect(PRICING["claude-opus-4-7"]).toBeDefined();
    expect(PRICING["claude-haiku-4-5"]).toBeDefined();
  });

  it("Opus is more expensive than Sonnet, which is more expensive than Haiku", () => {
    expect(PRICING["claude-opus-4-7"].input).toBeGreaterThan(PRICING["claude-sonnet-4-6"].input);
    expect(PRICING["claude-sonnet-4-6"].input).toBeGreaterThan(PRICING["claude-haiku-4-5"].input);
  });
});

describe("costFor", () => {
  const sonnet = { input_tokens: 1_000_000, output_tokens: 0, cache_read: 0, cache_create: 0 };
  const sonnetOutOnly = { input_tokens: 0, output_tokens: 1_000_000, cache_read: 0, cache_create: 0 };

  it("prices 1M Sonnet input tokens at exactly the table rate", () => {
    expect(costFor("claude-sonnet-4-6", sonnet)).toBeCloseTo(3.0, 6);
  });

  it("prices 1M Sonnet output tokens at exactly the table rate", () => {
    expect(costFor("claude-sonnet-4-6", sonnetOutOnly)).toBeCloseTo(15.0, 6);
  });

  it("cache reads cost ~10% of base input rate", () => {
    const usage = { input_tokens: 0, output_tokens: 0, cache_read: 1_000_000, cache_create: 0 };
    // Sonnet input is $3/MTok → cache read should be $0.30/MTok
    expect(costFor("claude-sonnet-4-6", usage)).toBeCloseTo(0.3, 6);
  });

  it("cache writes cost 1.25× base input rate (5-min TTL)", () => {
    const usage = { input_tokens: 0, output_tokens: 0, cache_read: 0, cache_create: 1_000_000 };
    expect(costFor("claude-sonnet-4-6", usage)).toBeCloseTo(3.75, 6);
  });

  it("totals all four components", () => {
    const usage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read: 5000,
      cache_create: 200,
    };
    const expected =
      (1000 * 3) / 1_000_000 +     // input
      (500 * 15) / 1_000_000 +     // output
      (5000 * 3 * 0.1) / 1_000_000 + // cache read
      (200 * 3 * 1.25) / 1_000_000;   // cache write
    expect(costFor("claude-sonnet-4-6", usage)).toBeCloseTo(expected, 8);
  });

  it("falls back to Sonnet pricing for unknown models (no error)", () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 0, cache_read: 0, cache_create: 0 };
    expect(costFor("claude-fictional-99", usage)).toBeCloseTo(3.0, 6);
  });

  it("returns zero for an empty usage object", () => {
    const usage = { input_tokens: 0, output_tokens: 0, cache_read: 0, cache_create: 0 };
    expect(costFor("claude-sonnet-4-6", usage)).toBe(0);
  });
});

describe("costBreakdown", () => {
  it("returns each component separately, summing to total", () => {
    const usage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read: 5000,
      cache_create: 200,
    };
    const b = costBreakdown("claude-sonnet-4-6", usage);
    expect(b.input).toBeCloseTo(0.003, 8);
    expect(b.output).toBeCloseTo(0.0075, 8);
    expect(b.cacheRead).toBeCloseTo(0.0015, 8);
    expect(b.cacheWrite).toBeCloseTo(0.00075, 8);
    expect(b.total).toBeCloseTo(b.input + b.output + b.cacheRead + b.cacheWrite, 10);
  });
});

describe("knownModel", () => {
  it("recognizes models in the price table", () => {
    expect(knownModel("claude-sonnet-4-6")).toBe(true);
    expect(knownModel("claude-opus-4-7")).toBe(true);
  });

  it("returns false for typos and unknown models (so the report can warn)", () => {
    expect(knownModel("claude-sonet-4-6")).toBe(false);
    expect(knownModel("gpt-4")).toBe(false);
    expect(knownModel("")).toBe(false);
  });
});
