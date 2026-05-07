import { config } from "../config.js";
import { logger } from "../logger.js";
import type { TaskFrontmatter } from "../vault/schemas.js";
import { linearClient, linearEnabled, linearIssueUrl } from "./client.js";
import {
  labelsToWaitingOn,
  linearPriorityToVault,
  linearStateToVault,
} from "./mapping.js";

/**
 * Linear issue rendered into our internal task shape, plus a `source` tag
 * so the dispatcher can distinguish vault rows from Linear rows when
 * merging. The id is Linear's identifier (e.g. "CNCL-42") — distinguishable
 * from vault IDs (which are "T-YYYYMMDD-slug") by prefix alone.
 */
export type LinearTaskRow = {
  source: "linear";
  id: string;
  title: string;
  project: string;
  priority: TaskFrontmatter["priority"];
  status: TaskFrontmatter["status"];
  deadline: string | null;
  type: TaskFrontmatter["type"];
  waiting_on: string | null;
  url: string | null;
};

export type ListLinearFilter = {
  project?: string;
  status?: TaskFrontmatter["status"][];
  /** Case-insensitive substring match against the matched team-member label. */
  waitingOn?: string;
  noDeadline?: boolean;
};

/**
 * Query Linear for issues in the configured team, mapped to the internal
 * task shape. Returns an empty array (silently) when Linear is disabled
 * or when the Linear API errors — list_tasks should keep working from
 * vault data even if Linear is down.
 *
 * Filtering strategy:
 * - `team` and `project` are pushed into the Linear API filter (efficient).
 * - `noDeadline` is also pushed (Linear supports `dueDate: { null: true }`).
 * - `status` and `waitingOn` filter post-fetch — they require label/state
 *   relations that aren't trivially expressible in Linear's filter API,
 *   and post-filtering on a small result set is fine for v1 volume.
 */
export async function listLinearIssues(
  filter?: ListLinearFilter,
): Promise<LinearTaskRow[]> {
  if (!linearEnabled()) return [];
  const client = linearClient();
  if (!client) return [];

  // Build server-side filter
  const apiFilter: Record<string, unknown> = {
    team: { key: { eq: config.linear.teamKey } },
  };
  if (filter?.project) {
    apiFilter.project = { name: { eq: filter.project } };
  }
  if (filter?.noDeadline) {
    apiFilter.dueDate = { null: true };
  }

  let issues;
  try {
    issues = await client.issues({ filter: apiFilter, first: 100 });
  } catch (err) {
    logger.warn({ err }, "linear issues query failed — returning empty");
    return [];
  }

  const employees = config.operator.teamMembers;
  const out: LinearTaskRow[] = [];

  for (const issue of issues.nodes) {
    let stateName = "Todo";
    let stateType = "unstarted";
    let projectName = "";
    let labelNames: string[] = [];

    try {
      const [state, project, labels] = await Promise.all([
        issue.state,
        issue.project,
        issue.labels(),
      ]);
      if (state) {
        stateName = state.name;
        stateType = state.type;
      }
      if (project) projectName = project.name;
      labelNames = labels.nodes.map((l) => l.name);
    } catch (err) {
      logger.warn({ err, id: issue.identifier }, "linear issue relation fetch failed");
      // Continue with defaults; the row is still useful if partial.
    }

    const status = linearStateToVault({ type: stateType, name: stateName });
    const waiting_on = labelsToWaitingOn(labelNames, employees);

    // Apply post-fetch filters
    if (filter?.status && !filter.status.includes(status)) continue;
    if (filter?.waitingOn) {
      const needle = filter.waitingOn.trim().toLowerCase();
      if (needle.length > 0) {
        const wo = (waiting_on ?? "").toLowerCase();
        if (!wo.includes(needle)) continue;
      }
    }

    out.push({
      source: "linear",
      id: issue.identifier,
      title: issue.title,
      project: projectName || "Personal",
      priority: linearPriorityToVault(issue.priority ?? null),
      status,
      deadline: issue.dueDate ? toIsoDate(issue.dueDate) : null,
      type: "task", // Linear has no type analog; everything is a task.
      waiting_on,
      url: linearIssueUrl(issue.identifier),
    });
  }

  return out;
}

/** Linear returns dueDate as a JS Date or ISO string depending on the path. */
function toIsoDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}
