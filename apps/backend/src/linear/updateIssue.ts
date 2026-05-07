import { logger } from "../logger.js";
import type { TaskFrontmatter } from "../vault/schemas.js";
import { linearClient, linearEnabled } from "./client.js";
import { getLookups } from "./lookups.js";
import {
  vaultPriorityToLinear,
  vaultStatusToLinearStateName,
} from "./mapping.js";

export type UpdateLinearPatch = {
  title?: string;
  status?: TaskFrontmatter["status"];
  priority?: TaskFrontmatter["priority"];
  deadline?: string | null;
  project?: string;
  /**
   * Replace the issue's employee label. Pass the new value; existing
   * employee labels are removed before adding the new one. Pass null to
   * remove the employee label without adding a replacement.
   */
  waitingOnReplace?: string | null;
  /** Optional human-readable line appended as a Linear comment. */
  logEntry?: string;
};

export type UpdateLinearResult = { ok: true } | { ok: false; error: string };

/**
 * Apply a vault-side patch to the corresponding Linear issue. The vault
 * write is the source of truth; this function mirrors the change. On
 * Linear failure we log and return ok:false but do NOT rollback the vault
 * (that would discard durable operator intent).
 *
 * Caller passes the human identifier (e.g. "CNCL-42"); the SDK accepts it
 * directly without a separate UUID lookup.
 */
export async function updateLinearIssue(
  identifier: string,
  patch: UpdateLinearPatch,
  knownEmployees: string[],
): Promise<UpdateLinearResult> {
  if (!linearEnabled()) return { ok: false, error: "linear disabled" };
  const client = linearClient();
  if (!client) return { ok: false, error: "linear client unavailable" };

  const lookups = await getLookups();
  if (!lookups) return { ok: false, error: "linear lookups unavailable" };

  // Locate the issue. Linear SDK accepts the human identifier and
  // returns the full Issue object.
  let issue;
  try {
    issue = await client.issue(identifier);
  } catch (err) {
    logger.warn({ err, identifier }, "linear issue lookup failed");
    return { ok: false, error: `linear issue '${identifier}' not found` };
  }

  // Build the update payload. Empty patches still go through (Linear
  // accepts no-op updates), but we short-circuit if there's nothing to
  // do AND no comment to leave.
  const update: Record<string, unknown> = {};

  if (patch.title) update.title = patch.title;
  if (patch.priority) update.priority = vaultPriorityToLinear(patch.priority);
  if (patch.deadline !== undefined) update.dueDate = patch.deadline; // null clears

  if (patch.status) {
    const stateName = vaultStatusToLinearStateName(patch.status);
    if (stateName) {
      const stateId = lookups.workflowStateIdsByName.get(stateName.toLowerCase());
      if (stateId) update.stateId = stateId;
      else {
        logger.warn(
          { wanted: stateName },
          "linear workflow state not found — skipping status update",
        );
      }
    }
  }

  if (patch.project) {
    const projectId = lookups.projectIdsByName.get(patch.project);
    if (projectId) update.projectId = projectId;
    else {
      logger.warn(
        { wanted: patch.project },
        "linear project not found — skipping project update",
      );
    }
  }

  if (patch.waitingOnReplace !== undefined) {
    // Re-derive the issue's existing labels, strip any employee label,
    // optionally add the new one. Linear's update API replaces the
    // labelIds array wholesale, so we must include non-employee labels too.
    let existingLabelIds: string[] = [];
    let existingLabelNames: string[] = [];
    try {
      const labelConn = await issue.labels();
      existingLabelIds = labelConn.nodes.map((l) => l.id);
      existingLabelNames = labelConn.nodes.map((l) => l.name);
    } catch (err) {
      logger.warn({ err }, "linear issue labels fetch failed during update");
    }

    // Filter out existing employee labels (paired with names by index)
    const keepIds = existingLabelIds.filter((_, i) => {
      const name = existingLabelNames[i];
      const isEmployee = name && knownEmployees.some((e) => e.toLowerCase() === name.toLowerCase());
      return !isEmployee;
    });

    // Add the new employee label, if any
    if (patch.waitingOnReplace) {
      const newId = lookups.labelIdsByName.get(patch.waitingOnReplace.toLowerCase());
      if (newId) keepIds.push(newId);
      else {
        logger.info(
          { waiting_on: patch.waitingOnReplace },
          "no linear label for new waiting_on — issue will have no employee label",
        );
      }
    }

    update.labelIds = keepIds;
  }

  // Apply the update if there's anything to change
  let updateOk = true;
  if (Object.keys(update).length > 0) {
    try {
      const result = await client.updateIssue(issue.id, update);
      if (!result.success) {
        updateOk = false;
        logger.warn({ identifier, update }, "linear updateIssue returned success=false");
      }
    } catch (err) {
      logger.warn({ err, identifier, update }, "linear updateIssue failed");
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Append the log entry as a comment, separately. A failed comment
  // doesn't fail the whole update (it's commentary, not state).
  if (patch.logEntry && patch.logEntry.trim().length > 0) {
    try {
      await client.createComment({
        issueId: issue.id,
        body: patch.logEntry.trim(),
      });
    } catch (err) {
      logger.warn({ err, identifier }, "linear comment create failed (non-fatal)");
    }
  }

  if (!updateOk) return { ok: false, error: "linear update returned non-success" };
  return { ok: true };
}
