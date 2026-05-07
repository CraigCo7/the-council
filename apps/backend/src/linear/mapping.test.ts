import { describe, it, expect } from "vitest";
import {
  labelsToWaitingOn,
  linearPriorityToVault,
  linearStateToVault,
  vaultPriorityToLinear,
  vaultStatusToLinearStateName,
} from "./mapping.js";

describe("linearPriorityToVault", () => {
  it("maps Linear's documented priority numbers to our P-letters", () => {
    expect(linearPriorityToVault(1)).toBe("P0"); // Urgent
    expect(linearPriorityToVault(2)).toBe("P1"); // High
    expect(linearPriorityToVault(3)).toBe("P2"); // Medium
    expect(linearPriorityToVault(4)).toBe("P3"); // Low
  });

  it("treats Linear's 'No priority' (0) as P3, not P2", () => {
    expect(linearPriorityToVault(0)).toBe("P3");
  });

  it("defaults null/undefined to P3", () => {
    expect(linearPriorityToVault(null)).toBe("P3");
    expect(linearPriorityToVault(undefined)).toBe("P3");
  });
});

describe("vaultPriorityToLinear", () => {
  it("inverts the priority mapping", () => {
    expect(vaultPriorityToLinear("P0")).toBe(1);
    expect(vaultPriorityToLinear("P1")).toBe(2);
    expect(vaultPriorityToLinear("P2")).toBe(3);
    expect(vaultPriorityToLinear("P3")).toBe(4);
  });
});

describe("linearStateToVault", () => {
  it("maps state types to vault status", () => {
    expect(linearStateToVault({ type: "completed", name: "Done" })).toBe("done");
    expect(linearStateToVault({ type: "canceled", name: "Canceled" })).toBe("dropped");
    expect(linearStateToVault({ type: "started", name: "In Progress" })).toBe("in_progress");
    expect(linearStateToVault({ type: "unstarted", name: "Todo" })).toBe("open");
    expect(linearStateToVault({ type: "backlog", name: "Backlog" })).toBe("open");
    expect(linearStateToVault({ type: "triage", name: "Triage" })).toBe("open");
  });

  it("special-cases a state literally named 'Blocked' regardless of group", () => {
    // Operator put Blocked in the In Progress group; mapper still recognizes it
    expect(linearStateToVault({ type: "started", name: "Blocked" })).toBe("blocked");
    // And in Unstarted group
    expect(linearStateToVault({ type: "unstarted", name: "Blocked" })).toBe("blocked");
  });

  it("matches 'Blocked' case-insensitively", () => {
    expect(linearStateToVault({ type: "started", name: "blocked" })).toBe("blocked");
    expect(linearStateToVault({ type: "started", name: "BLOCKED" })).toBe("blocked");
  });

  it("falls back to 'open' on unknown state types", () => {
    expect(linearStateToVault({ type: "wat", name: "Random" })).toBe("open");
  });
});

describe("vaultStatusToLinearStateName", () => {
  it("returns the canonical Linear state name for each vault status", () => {
    expect(vaultStatusToLinearStateName("open")).toBe("Todo");
    expect(vaultStatusToLinearStateName("in_progress")).toBe("In Progress");
    expect(vaultStatusToLinearStateName("blocked")).toBe("Blocked");
    expect(vaultStatusToLinearStateName("done")).toBe("Done");
    expect(vaultStatusToLinearStateName("dropped")).toBe("Canceled");
  });
});

describe("labelsToWaitingOn", () => {
  const employees = ["Jake", "Christian", "Carlo", "Eileen"];

  it("returns the matched employee name when their label is present", () => {
    expect(labelsToWaitingOn(["Christian"], employees)).toBe("Christian");
  });

  it("matches case-insensitively", () => {
    expect(labelsToWaitingOn(["christian"], employees)).toBe("Christian");
    expect(labelsToWaitingOn(["JAKE"], employees)).toBe("Jake");
  });

  it("returns null when no employee label is present", () => {
    expect(labelsToWaitingOn(["bug", "v1"], employees)).toBeNull();
  });

  it("returns null when labels list is empty", () => {
    expect(labelsToWaitingOn([], employees)).toBeNull();
  });

  it("returns null when no employees are configured (mapper closed)", () => {
    expect(labelsToWaitingOn(["Jake"], [])).toBeNull();
  });

  it("returns first matching employee when multiple are labeled", () => {
    // Picks the first match in the configured order
    expect(labelsToWaitingOn(["Christian", "Jake"], employees)).toBe("Jake");
  });

  it("ignores extra non-employee labels", () => {
    expect(labelsToWaitingOn(["bug", "Eileen", "p1"], employees)).toBe("Eileen");
  });
});
