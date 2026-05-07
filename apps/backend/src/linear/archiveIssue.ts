import { logger } from "../logger.js";
import { linearClient, linearEnabled } from "./client.js";

export type ArchiveResult = { ok: true } | { ok: false; error: string };

/**
 * Archive a Linear issue by its human identifier (e.g. "CNCL-42"). Linear
 * doesn't expose hard delete via the SDK — `archiveIssue` is the public
 * close-and-hide path. Archived issues still exist (recoverable from the
 * UI) but disappear from default views, which is the right semantics for
 * "drop the X task" — the operator is dismissing it, not pretending it
 * never existed.
 */
export async function archiveLinearIssue(identifier: string): Promise<ArchiveResult> {
  if (!linearEnabled()) return { ok: false, error: "linear disabled" };
  const client = linearClient();
  if (!client) return { ok: false, error: "linear client unavailable" };

  let issue;
  try {
    issue = await client.issue(identifier);
  } catch (err) {
    logger.warn({ err, identifier }, "linear issue lookup failed for archive");
    return { ok: false, error: `linear issue '${identifier}' not found` };
  }

  try {
    const result = await client.archiveIssue(issue.id);
    if (!result.success) {
      return { ok: false, error: "linear archiveIssue returned success=false" };
    }
    return { ok: true };
  } catch (err) {
    logger.warn({ err, identifier }, "linear archiveIssue failed");
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
