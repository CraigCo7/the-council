import type { TaskFrontmatter } from "../vault/schemas.js";

/**
 * Linear's priority is a number (0–4); ours is a P-letter. Mapping reflects
 * Linear's documented values:
 *   0 = No priority   → P3 (default to lowest urgency)
 *   1 = Urgent        → P0
 *   2 = High          → P1
 *   3 = Medium        → P2
 *   4 = Low           → P3
 *
 * We default an unset Linear priority to P3 rather than P2 because "no
 * priority" usually means "just the backlog" — closer to someday than to
 * normal-default-action.
 */
export function linearPriorityToVault(p: number | null | undefined): TaskFrontmatter["priority"] {
  switch (p) {
    case 1:
      return "P0";
    case 2:
      return "P1";
    case 3:
      return "P2";
    case 4:
      return "P3";
    default:
      return "P3"; // 0 / null / undefined
  }
}

export function vaultPriorityToLinear(p: TaskFrontmatter["priority"]): number {
  switch (p) {
    case "P0":
      return 1;
    case "P1":
      return 2;
    case "P2":
      return 3;
    case "P3":
      return 4;
  }
}

/**
 * Linear workflow states are arbitrary per team but each belongs to a
 * `type` group. The type is what we map on, not the human name — so
 * naming a state "Blocked" vs "Stalled" doesn't break our logic as long
 * as it's in the right group OR explicitly named "Blocked".
 *
 * Group → vault status:
 *   backlog    → open      (the task exists but hasn't been picked up)
 *   unstarted  → open      (also "Todo" by default)
 *   started    → in_progress  UNLESS the workflow state is named "Blocked"
 *                              (or matches our special-cased name); then "blocked"
 *   completed  → done
 *   canceled   → dropped
 *   triage     → open      (untriaged inbox)
 *
 * The name-based override on "blocked" lets the user put their Blocked
 * state in either Unstarted or Started group (Linear convention is
 * inconsistent on this) without us having to care.
 */
export function linearStateToVault(args: {
  type: string;
  name: string;
}): TaskFrontmatter["status"] {
  if (args.name.toLowerCase() === "blocked") return "blocked";
  switch (args.type) {
    case "completed":
      return "done";
    case "canceled":
      return "dropped";
    case "started":
      return "in_progress";
    case "backlog":
    case "unstarted":
    case "triage":
    default:
      return "open";
  }
}

/**
 * Reverse direction: when we want to update a Linear issue's status from
 * a vault status change, we need to pick which workflow state to set.
 * The caller must look up state IDs by name; this function returns the
 * canonical name to look up. Returns null when the vault status doesn't
 * have a single obvious target (caller decides how to handle).
 */
export function vaultStatusToLinearStateName(
  status: TaskFrontmatter["status"],
): string | null {
  switch (status) {
    case "open":
      return "Todo";
    case "in_progress":
      return "In Progress";
    case "blocked":
      return "Blocked";
    case "done":
      return "Done";
    case "dropped":
      return "Canceled";
    default:
      return null;
  }
}

/**
 * Pick the team-member name out of an issue's labels. The configured names
 * — Jake, Christian, Carlo, Eileen — function as pseudo-assignees on the
 * free tier where seats are scarce. Returns the first matching name (case-
 * insensitive). Returns null if no employee label is present.
 *
 * The caller passes the configured names list so the mapper doesn't import
 * config and stays unit-testable.
 */
export function labelsToWaitingOn(
  labelNames: string[],
  configuredEmployees: string[],
): string | null {
  if (labelNames.length === 0 || configuredEmployees.length === 0) return null;
  const lowerLabels = labelNames.map((l) => l.toLowerCase());
  for (const emp of configuredEmployees) {
    if (lowerLabels.includes(emp.toLowerCase())) return emp;
  }
  return null;
}
