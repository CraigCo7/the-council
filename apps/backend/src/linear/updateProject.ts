import { logger } from "../logger.js";
import { replaceMarkdownSection } from "../vault/markdown.js";
import { linearClient, linearEnabled } from "./client.js";
import { getLookups } from "./lookups.js";

export type UpdateLinearProjectResult =
  | { ok: true; url: string | null }
  | { ok: false; error: string };

/**
 * Mirror a vault project patch into the corresponding Linear project's
 * description. The vault write is the source of truth; this is best-effort
 * mirroring with the same non-fatal posture as the issue mirror — on failure
 * we log and return ok:false but the dispatcher still commits the vault.
 *
 * Sync strategy: section-level. For each heading the operator patched in the
 * vault body, we replace that same heading's content in the Linear project's
 * description (using the shared `replaceMarkdownSection` primitive). This
 * preserves any other content the operator might have written directly in
 * Linear (e.g. ad-hoc paragraphs above the structured sections).
 *
 * @param projectName Linear project name (matches the vault project name).
 * @param sections    Heading → rendered Markdown body, e.g. { "Key people": "- **Carlo**..." }
 */
export async function updateLinearProject(
  projectName: string,
  sections: Record<string, string>,
): Promise<UpdateLinearProjectResult> {
  if (!linearEnabled()) return { ok: false, error: "linear disabled" };
  const client = linearClient();
  if (!client) return { ok: false, error: "linear client unavailable" };

  const lookups = await getLookups();
  if (!lookups) return { ok: false, error: "linear lookups unavailable" };

  const projectId = lookups.projectIdsByName.get(projectName);
  if (!projectId) {
    return {
      ok: false,
      error: `linear project '${projectName}' not found — create it in Linear first`,
    };
  }

  // Nothing to mirror — succeed silently. (A frontmatter-only vault patch like
  // status=paused has no body sections to sync to Linear's description.)
  if (Object.keys(sections).length === 0) return { ok: true, url: null };

  let project;
  try {
    project = await client.project(projectId);
  } catch (err) {
    logger.warn({ err, projectName }, "linear project fetch failed");
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let description = project.description ?? "";
  for (const [heading, content] of Object.entries(sections)) {
    description = replaceMarkdownSection(description, heading, content);
  }

  try {
    const result = await client.updateProject(projectId, { description });
    if (!result.success) {
      return { ok: false, error: "linear updateProject returned success=false" };
    }
    // `project.url` is the canonical web URL the SDK exposes on the entity.
    return { ok: true, url: project.url ?? null };
  } catch (err) {
    logger.warn({ err, projectName }, "linear updateProject failed");
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
