import { describe, it, expect } from "vitest";
import {
  composeFinalText,
  receiptFor,
  stripModelReceipts,
} from "./chief-of-staff.js";

type ToolCall = { name: string; input: unknown; result: string; is_error?: boolean };

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
    expect(stripModelReceipts("✓ Captured: Buy milk")).toBe("");
  });

  it("strips a single ✓ Updated line", () => {
    expect(stripModelReceipts("✓ Updated: Buy milk")).toBe("");
  });

  it("strips a single ✓ Dropped line", () => {
    expect(stripModelReceipts("✓ Dropped: Buy milk")).toBe("");
  });

  it("preserves other lines", () => {
    const input = ["✓ Captured: Buy milk", "", "Note: heads up about a conflict."].join("\n");
    expect(stripModelReceipts(input)).toBe("Note: heads up about a conflict.");
  });

  it("does not strip a prefix mid-sentence", () => {
    expect(stripModelReceipts("After capture I'll mark ✓ Captured: as the result.")).toBe(
      "After capture I'll mark ✓ Captured: as the result.",
    );
  });

  it("returns input unchanged when no receipts are present", () => {
    expect(stripModelReceipts("Plain commentary about the task.")).toBe(
      "Plain commentary about the task.",
    );
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

  it("strips a forged receipt even when no real tool call ran (drift defense)", () => {
    expect(composeFinalText("✓ Captured: Buy milk", [])).toBe("");
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
