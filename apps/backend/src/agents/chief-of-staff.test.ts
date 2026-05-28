import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared mock fns, hoisted above the vi.mock factories that reference them.
const { createMock, dispatchMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  dispatchMock: vi.fn(),
}));

vi.mock("../llm/anthropic.js", () => ({
  anthropic: { messages: { create: createMock } },
  defaultsFor: () => ({ model: "test-model", max_tokens: 4000 }),
  logUsage: () => {},
}));
vi.mock("../tools/dispatch.js", () => ({ dispatchTool: dispatchMock }));
vi.mock("../tools/definitions.js", () => ({ toolDefinitions: () => [] }));
vi.mock("./prompt-loader.js", () => ({ loadPrompt: () => "SYSTEM PROMPT" }));

import {
  composeFinalText,
  isForgedWithoutBackingCall,
  receiptFor,
  runChiefOfStaff,
  stripModelReceipts,
} from "./chief-of-staff.js";

type ToolCall = { name: string; input: unknown; result: string; is_error?: boolean };

const USAGE = { input_tokens: 1, output_tokens: 1 };

const successfulCreate = (overrides: Partial<Record<string, unknown>> = {}): ToolCall => ({
  name: "create_task",
  input: {},
  result: JSON.stringify({
    ok: true,
    id: "T-20260506-buy-milk",
    relPath: "02-Tasks/2026/T-20260506-buy-milk.md",
    committed: true,
    hash: "abc123",
    task: {
      id: "T-20260506-buy-milk",
      title: "Buy milk",
      project: "Personal",
      priority: "P2",
      status: "open",
      type: "task",
      deadline: null,
      ...overrides,
    },
  }),
  is_error: false,
});

const successfulUpdate = (overrides: Partial<Record<string, unknown>> = {}): ToolCall => ({
  name: "update_task",
  input: {},
  result: JSON.stringify({
    ok: true,
    id: "T-20260506-buy-milk",
    committed: true,
    hash: "def456",
    task: {
      id: "T-20260506-buy-milk",
      title: "Buy milk",
      project: "Personal",
      priority: "P1",
      status: "open",
      type: "task",
      deadline: "2026-05-15",
      ...overrides,
    },
  }),
  is_error: false,
});

const successfulDelete = (overrides: Partial<Record<string, unknown>> = {}): ToolCall => ({
  name: "delete_task",
  input: {},
  result: JSON.stringify({
    ok: true,
    id: "T-20260506-buy-milk",
    committed: true,
    hash: "ghi789",
    task: {
      id: "T-20260506-buy-milk",
      title: "Buy milk",
      project: "Personal",
      priority: "P2",
      status: "open",
      type: "task",
      deadline: null,
      ...overrides,
    },
  }),
  is_error: false,
});

const failedCreate: ToolCall = {
  name: "create_task",
  input: {},
  result: JSON.stringify({ ok: false, error: "vault unreachable" }),
  is_error: true,
};

const listOnly: ToolCall = {
  name: "list_tasks",
  input: {},
  result: "[]",
  is_error: false,
};

describe("receiptFor", () => {
  it("builds a Captured receipt from a successful create_task with deadline", () => {
    const r = receiptFor(successfulCreate({ deadline: "2026-05-15", priority: "P1" }));
    expect(r).toBe("✓ Captured: Buy milk [Personal · P1 · 2026-05-15]");
  });

  it("renders 'no deadline' when deadline is null", () => {
    const r = receiptFor(successfulCreate({ deadline: null }));
    expect(r).toBe("✓ Captured: Buy milk [Personal · P2 · no deadline]");
  });

  it("builds an Updated receipt from update_task with the post-update state", () => {
    const r = receiptFor(successfulUpdate());
    expect(r).toBe("✓ Updated: Buy milk [Personal · P1 · 2026-05-15]");
  });

  it("returns null for errored create_task (no receipt for failed work)", () => {
    expect(receiptFor(failedCreate)).toBeNull();
  });

  it("returns null for non-task tool calls (list_tasks, etc.)", () => {
    expect(receiptFor(listOnly)).toBeNull();
  });

  it("returns null on a malformed JSON payload", () => {
    expect(
      receiptFor({ name: "create_task", input: {}, result: "not json", is_error: false }),
    ).toBeNull();
  });

  it("returns null when ok=true but task field is absent (legacy result shape)", () => {
    expect(
      receiptFor({
        name: "create_task",
        input: {},
        result: JSON.stringify({ ok: true, id: "T-x" }),
        is_error: false,
      }),
    ).toBeNull();
  });

  it("appends a markdown link when linear_id and linear_url are both present", () => {
    const r = receiptFor(
      successfulCreate({
        linear_id: "CNCL-42",
        linear_url: "https://linear.app/the-council-alfred/issue/CNCL-42",
      }),
    );
    expect(r).toBe(
      "✓ Captured: Buy milk [Personal · P2 · no deadline] [CNCL-42](https://linear.app/the-council-alfred/issue/CNCL-42)",
    );
  });

  it("appends bare identifier when linear_id is set but url is missing", () => {
    const r = receiptFor(successfulCreate({ linear_id: "CNCL-42", linear_url: null }));
    expect(r).toBe("✓ Captured: Buy milk [Personal · P2 · no deadline] CNCL-42");
  });

  it("renders the same way for ✓ Updated", () => {
    const r = receiptFor(
      successfulUpdate({
        linear_id: "CNCL-42",
        linear_url: "https://linear.app/foo/issue/CNCL-42",
      }),
    );
    expect(r).toBe(
      "✓ Updated: Buy milk [Personal · P1 · 2026-05-15] [CNCL-42](https://linear.app/foo/issue/CNCL-42)",
    );
  });

  it("falls back to the base format when neither linear field is present", () => {
    const r = receiptFor(successfulCreate());
    expect(r).toBe("✓ Captured: Buy milk [Personal · P2 · no deadline]");
  });

  it("hides type when it's the default `task`", () => {
    const r = receiptFor(successfulCreate({ type: "task" }));
    // No "· task" appended
    expect(r).toBe("✓ Captured: Buy milk [Personal · P2 · no deadline]");
  });

  it("surfaces type when it's reminder (operator can spot misclassifications)", () => {
    const r = receiptFor(successfulCreate({ type: "reminder" }));
    expect(r).toBe("✓ Captured: Buy milk [Personal · P2 · no deadline · reminder]");
  });

  it("surfaces type when it's delegated", () => {
    const r = receiptFor(successfulCreate({ type: "delegated" }));
    expect(r).toBe("✓ Captured: Buy milk [Personal · P2 · no deadline · delegated]");
  });

  it("surfaces type when it's waiting-for", () => {
    const r = receiptFor(successfulCreate({ type: "waiting-for" }));
    expect(r).toBe("✓ Captured: Buy milk [Personal · P2 · no deadline · waiting-for]");
  });

  it("surfaces type when it's idea", () => {
    const r = receiptFor(successfulCreate({ type: "idea" }));
    expect(r).toBe("✓ Captured: Buy milk [Personal · P2 · no deadline · idea]");
  });

  it("type tag appears BEFORE the linear link suffix", () => {
    const r = receiptFor(
      successfulCreate({
        type: "delegated",
        linear_id: "CNCL-3",
        linear_url: "https://linear.app/foo/issue/CNCL-3",
      }),
    );
    expect(r).toBe(
      "✓ Captured: Buy milk [Personal · P2 · no deadline · delegated] [CNCL-3](https://linear.app/foo/issue/CNCL-3)",
    );
  });

  it("renders ✓ Dropped: for a successful delete_task", () => {
    expect(receiptFor(successfulDelete())).toBe(
      "✓ Dropped: Buy milk [Personal · P2 · no deadline]",
    );
  });

  it("includes type tag in dropped receipt for non-default types", () => {
    expect(receiptFor(successfulDelete({ type: "reminder" }))).toBe(
      "✓ Dropped: Buy milk [Personal · P2 · no deadline · reminder]",
    );
  });

  it("includes Linear link in dropped receipt when linear_id was set", () => {
    expect(
      receiptFor(
        successfulDelete({
          linear_id: "CNCL-9",
          linear_url: "https://linear.app/foo/issue/CNCL-9",
        }),
      ),
    ).toBe(
      "✓ Dropped: Buy milk [Personal · P2 · no deadline] [CNCL-9](https://linear.app/foo/issue/CNCL-9)",
    );
  });

  it("returns null on errored delete_task", () => {
    const errored: ToolCall = {
      name: "delete_task",
      input: {},
      result: JSON.stringify({ ok: false, error: "task not found" }),
      is_error: true,
    };
    expect(receiptFor(errored)).toBeNull();
  });
});

describe("stripModelReceipts", () => {
  it("strips a single ✓ Captured line", () => {
    const r = stripModelReceipts("✓ Captured: Buy milk");
    expect(r.remaining).toBe("");
    expect(r.strippedCount).toBe(1);
  });

  it("strips a single ✓ Updated line", () => {
    const r = stripModelReceipts("✓ Updated: Buy milk");
    expect(r.remaining).toBe("");
    expect(r.strippedCount).toBe(1);
  });

  it("strips a single ✓ Dropped line", () => {
    const r = stripModelReceipts("✓ Dropped: Buy milk");
    expect(r.remaining).toBe("");
    expect(r.strippedCount).toBe(1);
  });

  it("preserves other lines", () => {
    const input = ["✓ Captured: Buy milk", "", "Note: heads up about a conflict."].join("\n");
    const r = stripModelReceipts(input);
    expect(r.remaining).toBe("Note: heads up about a conflict.");
    expect(r.strippedCount).toBe(1);
  });

  it("does not strip a prefix mid-sentence", () => {
    const r = stripModelReceipts("After capture I'll mark ✓ Captured: as the result.");
    expect(r.remaining).toBe("After capture I'll mark ✓ Captured: as the result.");
    expect(r.strippedCount).toBe(0);
  });

  it("returns input unchanged when no receipts are present", () => {
    const r = stripModelReceipts("Plain commentary about the task.");
    expect(r.remaining).toBe("Plain commentary about the task.");
    expect(r.strippedCount).toBe(0);
  });

  it("counts multiple stripped lines", () => {
    const input = ["✓ Captured: A", "✓ Updated: B", "real commentary"].join("\n");
    const r = stripModelReceipts(input);
    expect(r.remaining).toBe("real commentary");
    expect(r.strippedCount).toBe(2);
  });
});

describe("composeFinalText", () => {
  it("synthesizes a receipt and prepends it to commentary", () => {
    const out = composeFinalText("Note: defaulted to Personal.", [successfulCreate()]);
    expect(out).toBe("✓ Captured: Buy milk [Personal · P2 · no deadline]\n\nNote: defaulted to Personal.");
  });

  it("returns just the synthesized receipt when the model wrote nothing useful", () => {
    expect(composeFinalText("", [successfulCreate()])).toBe(
      "✓ Captured: Buy milk [Personal · P2 · no deadline]",
    );
  });

  it("returns just the receipt when model only wrote a (stripped) forgery", () => {
    expect(composeFinalText("✓ Captured: Buy milk", [successfulCreate()])).toBe(
      "✓ Captured: Buy milk [Personal · P2 · no deadline]",
    );
  });

  it("returns commentary alone when no successful capture/update happened", () => {
    expect(composeFinalText("Here are your overdue tasks.", [listOnly])).toBe(
      "Here are your overdue tasks.",
    );
  });

  it("returns the phantom-receipt meta-message when forged receipt is the only thing the model wrote", () => {
    // Model wrote `✓ Captured:` without calling create_task. We strip it,
    // and the operator would otherwise get an empty Telegram message.
    // Surface a meta-failure instead so the operator knows to retry.
    const out = composeFinalText("✓ Captured: Buy milk", []);
    expect(out).toContain("(Council)");
    expect(out).toContain("didn't actually call the tool");
    expect(out).not.toContain("✓ Captured:");
  });

  it("returns a meta-message when model produced empty output AND no tools ran", () => {
    const out = composeFinalText("", []);
    expect(out).toContain("(Council)");
    expect(out).toContain("nothing to say");
  });

  it("preserves commentary even when receipt was forged and stripped", () => {
    // Mixed case: model wrote a forged receipt + real commentary about
    // an inference. Strip the receipt; preserve the commentary.
    const out = composeFinalText("✓ Captured: Buy milk\n\nNote: defaulted to Personal.", []);
    expect(out).toBe("Note: defaulted to Personal.");
  });

  it("handles multiple successful tool calls in one turn (one receipt each)", () => {
    const out = composeFinalText("", [successfulCreate({ title: "Buy milk" }), successfulCreate({ title: "Buy bread" })]);
    expect(out).toBe(
      [
        "✓ Captured: Buy milk [Personal · P2 · no deadline]",
        "✓ Captured: Buy bread [Personal · P2 · no deadline]",
      ].join("\n"),
    );
  });

  it("does not synthesize a receipt when the tool errored", () => {
    expect(composeFinalText("Vault is offline.", [failedCreate])).toBe("Vault is offline.");
  });
});

describe("isForgedWithoutBackingCall", () => {
  it("is true when a receipt was written but no tool ran", () => {
    expect(isForgedWithoutBackingCall("✓ Captured: Buy milk", [])).toBe(true);
  });

  it("is true when a receipt was written but only a read tool ran", () => {
    expect(isForgedWithoutBackingCall("✓ Updated: Buy milk", [listOnly])).toBe(true);
  });

  it("is true when the backing write tool errored (receipt still unbacked)", () => {
    expect(isForgedWithoutBackingCall("✓ Captured: Buy milk", [failedCreate])).toBe(true);
  });

  it("is false when a successful write tool backs the receipt", () => {
    expect(isForgedWithoutBackingCall("✓ Captured: Buy milk", [successfulCreate()])).toBe(false);
  });

  it("is false when the model wrote no receipt line at all", () => {
    expect(isForgedWithoutBackingCall("Here are your overdue tasks.", [])).toBe(false);
  });
});

describe("runChiefOfStaff phantom-receipt recovery", () => {
  beforeEach(() => {
    createMock.mockReset();
    dispatchMock.mockReset();
  });

  it("forces a tool call after a forged receipt, so the capture actually lands", async () => {
    // Turn 1: model forges a receipt with no tool call.
    createMock.mockResolvedValueOnce({
      stop_reason: "end_turn",
      usage: USAGE,
      content: [{ type: "text", text: "✓ Captured: Buy milk [Personal · P2 · no deadline]" }],
    });
    // Turn 2 (forced): model actually calls create_task.
    createMock.mockResolvedValueOnce({
      stop_reason: "tool_use",
      usage: USAGE,
      content: [{ type: "tool_use", id: "tu1", name: "create_task", input: { title: "Buy milk" } }],
    });
    // Turn 3: model ends with nothing to add; the real receipt is synthesized.
    createMock.mockResolvedValueOnce({
      stop_reason: "end_turn",
      usage: USAGE,
      content: [{ type: "text", text: "" }],
    });
    dispatchMock.mockResolvedValueOnce({
      content: JSON.stringify({
        ok: true,
        task: { title: "Buy milk", project: "Personal", priority: "P2", deadline: null, type: "task" },
      }),
      is_error: false,
    });

    const out = await runChiefOfStaff({ userMessage: "remember to buy milk" });

    expect(out.text).toBe("✓ Captured: Buy milk [Personal · P2 · no deadline]");
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith("create_task", { title: "Buy milk" });
    expect(createMock).toHaveBeenCalledTimes(3);
    // The retry request forces a tool call; the first and last do not.
    expect(createMock.mock.calls[0][0].tool_choice).toBeUndefined();
    expect(createMock.mock.calls[1][0].tool_choice).toEqual({ type: "any" });
    expect(createMock.mock.calls[2][0].tool_choice).toBeUndefined();
  });

  it("does not retry when a genuine capture happened in one turn", async () => {
    createMock.mockResolvedValueOnce({
      stop_reason: "tool_use",
      usage: USAGE,
      content: [{ type: "tool_use", id: "tu1", name: "create_task", input: { title: "Buy milk" } }],
    });
    createMock.mockResolvedValueOnce({
      stop_reason: "end_turn",
      usage: USAGE,
      content: [{ type: "text", text: "" }],
    });
    dispatchMock.mockResolvedValueOnce({
      content: JSON.stringify({
        ok: true,
        task: { title: "Buy milk", project: "Personal", priority: "P2", deadline: null, type: "task" },
      }),
      is_error: false,
    });

    const out = await runChiefOfStaff({ userMessage: "remember to buy milk" });

    expect(out.text).toBe("✓ Captured: Buy milk [Personal · P2 · no deadline]");
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls.every((c) => c[0].tool_choice === undefined)).toBe(true);
  });

  it("gives up after MAX_FORGE_RETRIES and surfaces the meta-failure rather than looping forever", async () => {
    // The model forges on every turn, even when forced. tool_choice:any would
    // normally guarantee a tool_use, but we simulate a stubborn model to prove
    // the retry budget is bounded and the operator still gets a visible signal.
    createMock.mockResolvedValue({
      stop_reason: "end_turn",
      usage: USAGE,
      content: [{ type: "text", text: "✓ Captured: Buy milk [Personal · P2 · no deadline]" }],
    });

    const out = await runChiefOfStaff({ userMessage: "remember to buy milk" });

    // 1 initial + 2 forced retries = 3 calls, then it returns the fallback.
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(out.text).toContain("(Council)");
    expect(out.text).toContain("didn't actually call the tool");
  });
});
