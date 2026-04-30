import { describe, it, expect } from "vitest";
import { mdToTelegramHtml } from "./telegram.js";

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
});
