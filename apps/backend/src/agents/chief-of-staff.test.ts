import { describe, it, expect } from "vitest";
import { guardConfirmations } from "./chief-of-staff.js";

type ToolCall = { name: string; input: unknown; result: string; is_error?: boolean };

const noTools: ToolCall[] = [];
const captureOk: ToolCall[] = [
  { name: "create_task", input: {}, result: '{"ok":true}', is_error: false },
];
const updateOk: ToolCall[] = [
  { name: "update_task", input: {}, result: '{"ok":true}', is_error: false },
];
const captureFailed: ToolCall[] = [
  { name: "create_task", input: {}, result: '{"ok":false}', is_error: true },
];
const listOnly: ToolCall[] = [
  { name: "list_tasks", input: {}, result: "[]", is_error: false },
];

describe("guardConfirmations", () => {
  it("passes through a real ✓ Captured when create_task succeeded", () => {
    const text = "✓ Captured: Buy milk [Personal · P2]";
    expect(guardConfirmations(text, captureOk)).toBe(text);
  });

  it("passes through a real ✓ Updated when update_task succeeded", () => {
    const text = "✓ Updated: Buy milk → P1";
    expect(guardConfirmations(text, updateOk)).toBe(text);
  });

  it("strips a forged ✓ Captured when no create_task ran", () => {
    const text = "✓ Captured: Buy milk [Personal · P2]";
    const out = guardConfirmations(text, noTools);
    expect(out).not.toContain("✓ Captured:");
    expect(out).toContain("did not actually call the tool");
  });

  it("strips a forged ✓ Updated when no update_task ran", () => {
    const text = "✓ Updated: something";
    const out = guardConfirmations(text, listOnly);
    expect(out).not.toContain("✓ Updated:");
    expect(out).toContain("did not actually call the tool");
  });

  it("strips a forged ✓ Captured when create_task ERRORED (is_error true)", () => {
    const text = "✓ Captured: Buy milk";
    const out = guardConfirmations(text, captureFailed);
    expect(out).not.toContain("✓ Captured:");
  });

  it("preserves remaining content after stripping a forged receipt", () => {
    const text = [
      "✓ Captured: Buy milk [Personal · P2]",
      "",
      "Note: don't forget the receipt is in your wallet.",
    ].join("\n");
    const out = guardConfirmations(text, noTools);
    expect(out).toContain("Note: don't forget");
    expect(out).not.toContain("✓ Captured:");
    expect(out).toContain("did not actually call the tool");
  });

  it("falls back to the warning-only message when the entire response was forged", () => {
    const text = "✓ Captured: Buy milk";
    const out = guardConfirmations(text, noTools);
    expect(out.split("\n\n").length).toBe(1); // notice only, nothing else
  });

  it("does not strip when the line uses the prefix mid-sentence (false-positive guard)", () => {
    const text = "I will mark this as ✓ Captured: only after the tool returns.";
    // line does NOT start with the prefix — so it should pass through
    const out = guardConfirmations(text, noTools);
    expect(out).toBe(text);
  });

  it("handles a multi-block response with both forged and real content", () => {
    const text = [
      "✓ Captured: Buy milk",
      "",
      "✓ Updated: Buy bread → P1",
    ].join("\n");
    // create succeeded, update did NOT
    const out = guardConfirmations(text, captureOk);
    expect(out).toContain("✓ Captured: Buy milk");
    expect(out).not.toContain("✓ Updated:");
    expect(out).toContain("did not actually call the tool");
  });

  it("returns text unchanged on a normal status reply (no prefixes at all)", () => {
    const text = "**Name:** Buy milk\n**Project:** Personal";
    expect(guardConfirmations(text, listOnly)).toBe(text);
  });
});
