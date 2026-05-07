import { config } from "../config.js";
import { logger } from "../logger.js";
import type { TaskFrontmatter } from "../vault/schemas.js";
import { linearClient, linearEnabled, linearIssueUrl } from "./client.js";
import { getLookups } from "./lookups.js";
import { vaultPriorityToLinear } from "./mapping.js";

export type CreateLinearInput = {
  title: string;
  type: TaskFrontmatter["type"];
  project: string;            // Linear project name
  priority: TaskFrontmatter["priority"];
  deadline?: string | null;   // YYYY-MM-DD
  waiting_on?: string | null; // Employee name → matching label
  context?: string;           // Free-form description
};

export type CreateLinearResult = {
  ok: true;
  identifier: string;         // e.g. "CNCL-42"
  url: string | null;
} | {
  ok: false;
  error: string;
};

/**
 * Create a Linear issue from internal task input. Returns details that
 * the dispatcher writes back into the vault frontmatter.
 *
 * Behavior:
 * - Project lookup is name-based; an unknown project name fails the call
 *   (the bot should never produce one — projects are enum'd at the prompt
 *   level).
 * - Employee labels are best-effort. If `waiting_on` doesn't match any
 *   configured label name, we skip the label and put the name in the
 *   description so the operator can still recover the intent.
 * - waiting-for type sets the workflow state to "Blocked" (if it exists);
 *   delegated and task default to whatever Linear's "Todo" state is.
 *
 * Failures are returned, not thrown — the dispatcher decides whether to
 * proceed with vault-only.
 */
export async function createLinearIssue(input: CreateLinearInput): Promise<CreateLinearResult> {
  if (!linearEnabled()) {
    return { ok: false, error: "linear disabled" };
  }
  const client = linearClient();
  if (!client) return { ok: false, error: "linear client unavailable" };

  const lookups = await getLookups();
  if (!lookups) return { ok: false, error: "linear lookups unavailable" };

  const projectId = lookups.projectIdsByName.get(input.project);
  if (!projectId) {
    return {
      ok: false,
      error: `linear project '${input.project}' not found — create it in Linear first`,
    };
  }

  // Build labelIds: match the waiting_on name against employee labels.
  const labelIds: string[] = [];
  if (input.waiting_on) {
    const labelId = lookups.labelIdsByName.get(input.waiting_on.toLowerCase());
    if (labelId) {
      labelIds.push(labelId);
    } else {
      logger.info(
        { waiting_on: input.waiting_on, configured: config.operator.teamMembers },
        "no linear label found for waiting_on — adding name to description instead",
      );
    }
  }

  // Pick workflow state. Default = let Linear assign Todo. For waiting-for,
  // explicitly set Blocked if the workflow state exists.
  let stateId: string | undefined;
  if (input.type === "waiting-for") {
    stateId = lookups.workflowStateIdsByName.get("blocked");
  }

  // Compose description. If there's context AND an unmatched waiting_on,
  // append the latter so the operator can still tell who it's about.
  const descriptionLines: string[] = [];
  if (input.context && input.context.trim().length > 0) {
    descriptionLines.push(input.context.trim());
  }
  if (input.waiting_on && labelIds.length === 0) {
    descriptionLines.push(`Waiting on: ${input.waiting_on}`);
  }
  const description = descriptionLines.join("\n\n") || undefined;

  try {
    const result = await client.createIssue({
      teamId: lookups.teamId,
      projectId,
      title: input.title,
      description,
      priority: vaultPriorityToLinear(input.priority),
      dueDate: input.deadline ?? undefined,
      labelIds: labelIds.length > 0 ? labelIds : undefined,
      stateId,
    });

    if (!result.success) {
      return { ok: false, error: "linear createIssue returned success=false" };
    }
    const issue = await result.issue;
    if (!issue) {
      return { ok: false, error: "linear createIssue returned no issue" };
    }
    return {
      ok: true,
      identifier: issue.identifier,
      url: linearIssueUrl(issue.identifier),
    };
  } catch (err) {
    logger.warn({ err, input }, "linear createIssue failed");
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Predicate: should this task type also be mirrored to Linear? */
export function shouldMirrorToLinear(type: TaskFrontmatter["type"]): boolean {
  return type === "task" || type === "delegated" || type === "waiting-for";
}
