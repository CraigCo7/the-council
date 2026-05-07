import { describe, it, expect } from "vitest";
import { mdToTelegramHtml, humanizeDates } from "./telegram.js";

describe("mdToTelegramHtml", () => {
  it("converts double-asterisk bold to <b>", () => {
    expect(mdToTelegramHtml("**Name:** Buy gift")).toBe("<b>Name:</b> Buy gift");
  });

  it("converts inline backtick code to <code>", () => {
    expect(mdToTelegramHtml("Run `pnpm dev` to start")).toBe(
      "Run <code>pnpm dev</code> to start",
    );
  });

  it("escapes raw HTML special chars in user content", () => {
    expect(mdToTelegramHtml("revenue < 50k & growing")).toBe(
      "revenue &lt; 50k &amp; growing",
    );
  });

  it("does not double-escape inserted tags", () => {
    expect(mdToTelegramHtml("**Status:** open")).toBe("<b>Status:</b> open");
  });

  it("handles multiple bold spans on one line", () => {
    expect(mdToTelegramHtml("**Project:** BidaWash · **Priority:** P1")).toBe(
      "<b>Project:</b> BidaWash · <b>Priority:</b> P1",
    );
  });

  it("preserves a multi-task block exactly as the operator wants", () => {
    const input = [
      "**Name:** Buy birthday gift",
      "**Project:** Personal",
      "**Deadline:** 2026-04-30 (TODAY)",
      "---",
      "**Name:** Renew BidaWash insurance",
      "**Project:** BidaWash",
      "**Deadline:** 2026-05-15",
    ].join("\n");

    const expected = [
      "<b>Name:</b> Buy birthday gift",
      "<b>Project:</b> Personal",
      "<b>Deadline:</b> 2026-04-30 (TODAY)",
      "---",
      "<b>Name:</b> Renew BidaWash insurance",
      "<b>Project:</b> BidaWash",
      "<b>Deadline:</b> 2026-05-15",
    ].join("\n");

    expect(mdToTelegramHtml(input)).toBe(expected);
  });

  it("leaves unmatched single asterisks alone (e.g. multiplication)", () => {
    expect(mdToTelegramHtml("5 * 5 = 25")).toBe("5 * 5 = 25");
  });

  it("leaves an unclosed bold span alone (no malformed HTML)", () => {
    expect(mdToTelegramHtml("**unclosed and rolling on")).toBe(
      "**unclosed and rolling on",
    );
  });

  it("does not match across newlines (tight bold spans)", () => {
    expect(mdToTelegramHtml("**foo\n**not bold")).toBe("**foo\n**not bold");
  });

  it("escapes inside code blocks too — content stays literal", () => {
    expect(mdToTelegramHtml("`<3>`")).toBe("<code>&lt;3&gt;</code>");
  });

  it("converts markdown links to HTML anchors", () => {
    expect(
      mdToTelegramHtml("See [CNCL-42](https://linear.app/foo/issue/CNCL-42)"),
    ).toBe('See <a href="https://linear.app/foo/issue/CNCL-42">CNCL-42</a>');
  });

  it("preserves URL ampersands as HTML entities (valid inside href)", () => {
    expect(
      mdToTelegramHtml("[link](https://example.com/?a=1&b=2)"),
    ).toBe('<a href="https://example.com/?a=1&amp;b=2">link</a>');
  });

  it("does not match a malformed link where ] is missing", () => {
    expect(mdToTelegramHtml("[no closing bracket(url)")).toBe(
      "[no closing bracket(url)",
    );
  });

  it("does not match across newlines (link must be on one line)", () => {
    expect(mdToTelegramHtml("[text\n](url)")).toBe("[text\n](url)");
  });
});

describe("humanizeDates", () => {
  it("converts a single ISO date to Month Day Year", () => {
    expect(humanizeDates("Deadline: 2026-05-06")).toBe("Deadline: May 6 2026");
  });

  it("strips the leading zero on the day", () => {
    expect(humanizeDates("2026-01-09")).toBe("January 9 2026");
  });

  it("preserves a two-digit day", () => {
    expect(humanizeDates("2026-12-25")).toBe("December 25 2026");
  });

  it("converts every date in a multi-line response", () => {
    const input = [
      "**Deadline:** 2026-05-06 (TODAY)",
      "Created: 2026-04-30",
    ].join("\n");
    const expected = [
      "**Deadline:** May 6 2026 (TODAY)",
      "Created: April 30 2026",
    ].join("\n");
    expect(humanizeDates(input)).toBe(expected);
  });

  it("does NOT mangle ISO datetimes (negative lookahead on T)", () => {
    expect(humanizeDates("created: 2026-05-06T12:00:00+08:00")).toBe(
      "created: 2026-05-06T12:00:00+08:00",
    );
  });

  it("does NOT touch a task ID's compact date prefix", () => {
    // Task IDs use YYYYMMDD with no separators, so they shouldn't match anyway,
    // but verify the surrounding hyphens don't trigger a partial match either.
    expect(humanizeDates("T-20260506-buy-milk")).toBe("T-20260506-buy-milk");
  });

  it("rejects implausible months and days, returning the original", () => {
    expect(humanizeDates("2026-13-01")).toBe("2026-13-01");
    expect(humanizeDates("2026-05-32")).toBe("2026-05-32");
  });

  it("handles dates inside HTML bold tags untouched by the tags themselves", () => {
    expect(humanizeDates("<b>Deadline:</b> 2026-05-06")).toBe(
      "<b>Deadline:</b> May 6 2026",
    );
  });

  it("does NOT match a longer numeric run that contains a date pattern", () => {
    // 12026-05-061 should not partially match 2026-05-06
    expect(humanizeDates("12026-05-061")).toBe("12026-05-061");
  });

  it("returns text unchanged when no dates are present", () => {
    expect(humanizeDates("**Name:** Buy milk\nProject: Personal")).toBe(
      "**Name:** Buy milk\nProject: Personal",
    );
  });
});
