import path from "node:path";
import { z } from "zod";
import {
  ProjectEnum,
  ProjectFrontmatter,
} from "./schemas.js";
import { exists, readMarkdown, writeMarkdown } from "./fs.js";
import { replaceMarkdownSection } from "./markdown.js";
import { toLocalISODateTime } from "./time.js";

const PROJECTS_DIR = "01-Projects";

export type Project = {
  frontmatter: ProjectFrontmatter;
  body: string;
  relPath: string;
};

/**
 * Each entry in `key_people` is a structured person record. Alfred passes the
 * data shape; the renderer is responsible for the Markdown bullet format, so
 * the prompt cannot drift the layout.
 */
export const KeyPerson = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
});
export type KeyPerson = z.infer<typeof KeyPerson>;

/**
 * Patch a project file. All body-section fields accept structured input where
 * applicable (key_people) or free-form Markdown (north_star, current_focus,
 * blockers, links) — the dispatcher renders the section, never the model.
 *
 * Section→field mapping is stable so the same key set is reused by the Linear
 * mirror (see `linear/updateProject.ts`). Adding a new section means: add a
 * field here, render it, and add the same heading in the section-sync map.
 */
export const UpdateProjectInput = z.object({
  project: ProjectEnum,
  status: z.enum(["active", "paused", "archived"]).optional(),
  summary: z.string().optional(),
  north_star: z.string().optional(),
  current_focus: z.string().optional(),
  blockers: z.string().optional(),
  key_people: z.array(KeyPerson).optional(),
  links: z.string().optional(),
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectInput>;

function projectRelPath(name: string): string {
  return path.posix.join(PROJECTS_DIR, name, "_project.md");
}

export function readProject(name: string): Project | null {
  const rel = projectRelPath(name);
  if (!exists(rel)) return null;
  const { frontmatter, body } = readMarkdown<ProjectFrontmatter>(rel);
  return { frontmatter, body, relPath: rel };
}

/**
 * Stable name→heading map. Same headings are used in the Linear description
 * mirror so the two stay in sync via the same primitive (`replaceMarkdownSection`).
 * Keep this map in lockstep with `UpdateProjectInput` body fields.
 */
export const BODY_SECTION_HEADINGS: Record<string, string> = {
  north_star: "North star",
  current_focus: "Current focus",
  blockers: "Blockers",
  key_people: "Key people",
  links: "Links",
};

/**
 * Render a `key_people` array as the Markdown bullets that go into the
 * `## Key people` section. `[]` becomes `_(none)_` so an explicit clear is
 * visible rather than producing an empty heading.
 */
export function renderKeyPeople(people: KeyPerson[]): string {
  if (people.length === 0) return "_(none)_";
  return people
    .map((p) => (p.role ? `- **${p.name}** — ${p.role}` : `- **${p.name}**`))
    .join("\n");
}

/** Convert each provided body-section field on the patch into its rendered Markdown. */
export function renderedBodySections(
  patch: UpdateProjectInput,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (patch.north_star !== undefined) out[BODY_SECTION_HEADINGS.north_star] = patch.north_star;
  if (patch.current_focus !== undefined) out[BODY_SECTION_HEADINGS.current_focus] = patch.current_focus;
  if (patch.blockers !== undefined) out[BODY_SECTION_HEADINGS.blockers] = patch.blockers;
  if (patch.key_people !== undefined) out[BODY_SECTION_HEADINGS.key_people] = renderKeyPeople(patch.key_people);
  if (patch.links !== undefined) out[BODY_SECTION_HEADINGS.links] = patch.links;
  return out;
}

/**
 * List of the patch field names (not headings) that actually changed.
 * Used by the dispatcher to surface "what was patched" in the receipt.
 */
export function changedFields(patch: UpdateProjectInput): string[] {
  const keys: Array<keyof UpdateProjectInput> = [
    "status",
    "summary",
    "north_star",
    "current_focus",
    "blockers",
    "key_people",
    "links",
  ];
  return keys.filter((k) => patch[k] !== undefined).map(String);
}

/**
 * Apply a patch to a project file. Returns null if the project file is
 * missing (caller decides whether to error or seed). Returns the updated
 * Project on success; caller is responsible for git commit/push.
 */
export function updateProject(patch: UpdateProjectInput): Project | null {
  const existing = readProject(patch.project);
  if (!existing) return null;

  const now = toLocalISODateTime();

  // Frontmatter patch — only the small set of fields we surface as inputs.
  // Always bump `updated`. Other fields stay as-is.
  const nextFm: ProjectFrontmatter = ProjectFrontmatter.parse({
    ...existing.frontmatter,
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
    updated: now,
  });

  // Body patch — walk the section map; each provided field replaces its
  // heading's body via the shared markdown helper.
  let body = existing.body;
  for (const [heading, content] of Object.entries(renderedBodySections(patch))) {
    body = replaceMarkdownSection(body, heading, content);
  }

  writeMarkdown(existing.relPath, nextFm, body);
  return { frontmatter: nextFm, body, relPath: existing.relPath };
}
