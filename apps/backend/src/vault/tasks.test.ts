import { describe, it, expect } from "vitest";
import { matchesFilter } from "./tasks.js";
import type { TaskFrontmatter } from "./schemas.js";

const fm = (overrides: Partial<TaskFrontmatter> = {}): TaskFrontmatter => ({
  id: "T-20260507-test",
  title: "Test task",
  type: "task",
  status: "open",
  project: "BidaWash",
  priority: "P2",
  deadline: null,
  created: "2026-05-07T08:00:00+08:00",
  updated: "2026-05-07T08:00:00+08:00",
  tags: [],
  waiting_on: null,
  links: [],
  source: "manual",
  ...overrides,
});

describe("matchesFilter — status", () => {
  it("returns all when no filter is passed", () => {
    expect(matchesFilter(fm())).toBe(true);
  });

  it("matches when status is in the list", () => {
    expect(matchesFilter(fm({ status: "open" }), { status: ["open", "in_progress"] })).toBe(true);
  });

  it("rejects when status is not in the list", () => {
    expect(matchesFilter(fm({ status: "done" }), { status: ["open", "in_progress"] })).toBe(false);
  });
});

describe("matchesFilter — project", () => {
  it("matches the configured project exactly", () => {
    expect(matchesFilter(fm({ project: "BidaWash" }), { project: "BidaWash" })).toBe(true);
  });

  it("rejects a different project", () => {
    expect(matchesFilter(fm({ project: "Personal" }), { project: "BidaWash" })).toBe(false);
  });
});

describe("matchesFilter — overdueAsOf", () => {
  it("matches when deadline is before today", () => {
    expect(matchesFilter(fm({ deadline: "2026-05-01" }), { overdueAsOf: "2026-05-07" })).toBe(true);
  });

  it("rejects when deadline equals today (not yet overdue)", () => {
    expect(matchesFilter(fm({ deadline: "2026-05-07" }), { overdueAsOf: "2026-05-07" })).toBe(false);
  });

  it("rejects when there is no deadline", () => {
    expect(matchesFilter(fm({ deadline: null }), { overdueAsOf: "2026-05-07" })).toBe(false);
  });
});

describe("matchesFilter — waitingOn", () => {
  it("matches case-insensitive substring on waiting_on", () => {
    expect(matchesFilter(fm({ waiting_on: "Christian" }), { waitingOn: "chris" })).toBe(true);
    expect(matchesFilter(fm({ waiting_on: "Christian" }), { waitingOn: "CHRIS" })).toBe(true);
    expect(matchesFilter(fm({ waiting_on: "christian reyes" }), { waitingOn: "reyes" })).toBe(true);
  });

  it("rejects when waiting_on does not contain the needle", () => {
    expect(matchesFilter(fm({ waiting_on: "Jake" }), { waitingOn: "chris" })).toBe(false);
  });

  it("rejects when waiting_on is null", () => {
    expect(matchesFilter(fm({ waiting_on: null }), { waitingOn: "chris" })).toBe(false);
  });

  it("ignores an empty waitingOn filter (returns true regardless of waiting_on)", () => {
    expect(matchesFilter(fm({ waiting_on: null }), { waitingOn: "" })).toBe(true);
    expect(matchesFilter(fm({ waiting_on: "Jake" }), { waitingOn: "   " })).toBe(true);
  });

  it("trims whitespace from the needle before matching", () => {
    expect(matchesFilter(fm({ waiting_on: "Jake" }), { waitingOn: "  jake  " })).toBe(true);
  });
});

describe("matchesFilter — noDeadline", () => {
  it("matches when deadline is null and noDeadline is true", () => {
    expect(matchesFilter(fm({ deadline: null }), { noDeadline: true })).toBe(true);
  });

  it("rejects when a deadline is set and noDeadline is true", () => {
    expect(matchesFilter(fm({ deadline: "2026-05-15" }), { noDeadline: true })).toBe(false);
  });

  it("ignores noDeadline when false", () => {
    expect(matchesFilter(fm({ deadline: "2026-05-15" }), { noDeadline: false })).toBe(true);
  });
});

describe("matchesFilter — combined filters", () => {
  it("AND-combines all filters", () => {
    const open = fm({ status: "open", project: "BidaWash", waiting_on: "Christian", deadline: null });
    expect(
      matchesFilter(open, {
        status: ["open"],
        project: "BidaWash",
        waitingOn: "chris",
        noDeadline: true,
      }),
    ).toBe(true);
  });

  it("rejects if any single filter fails", () => {
    const open = fm({ status: "done", project: "BidaWash", waiting_on: "Christian", deadline: null });
    expect(
      matchesFilter(open, {
        status: ["open"],
        project: "BidaWash",
        waitingOn: "chris",
        noDeadline: true,
      }),
    ).toBe(false);
  });
});
