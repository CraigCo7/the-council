import path from "node:path";
import { z } from "zod";
import {
  ProjectEnum,
  TagList,
  TaskFrontmatter,
  TaskStatus,
  TaskType,
  Priority,
} from "./schemas.js";
import { deleteFile, exists, listMarkdown, readMarkdown, slugify, writeMarkdown } from "./fs.js";
import { compactDate, toLocalISODateTime } from "./time.js";

const TASKS_DIR = "02-Tasks";

export type Task = {
  frontmatter: TaskFrontmatter;
  body: string;
  relPath: string;
};

export const CreateTaskInput = z.object({
  title: z.string().min(1),
  project: ProjectEnum,
  type: TaskType.default("task"),
  priority: Priority.default("P2"),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  tags: TagList,
  waiting_on: z.string().nullable().optional(),
  context: z.string().default(""),
  source: z.enum(["chat", "whatsapp", "manual", "system", "cli", "http"]).default("manual"),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

export function taskRelPath(id: string): string {
  const year = id.slice(2, 6);
  return path.posix.join(TASKS_DIR, year, `${id}.md`);
}

export function createTask(input: CreateTaskInput): Task {
  const parsed = CreateTaskInput.parse(input);
  const now = toLocalISODateTime();
  const id = `T-${compactDate()}-${slugify(parsed.title)}`;

  const fm: TaskFrontmatter = {
    id,
    title: parsed.title,
    type: parsed.type,
    status: "open",
    project: parsed.project,
    priority: parsed.priority,
    deadline: parsed.deadline ?? null,
    created: now,
    updated: now,
    tags: parsed.tags,
    waiting_on: parsed.waiting_on ?? null,
    links: [],
    source: parsed.source,
  };

  const body = [
    "## Context",
    parsed.context || "_(captured)_",
    "",
    "## Log",
    `- ${toLocalISODateTime().slice(0, 10)} — captured`,
    "",
  ].join("\n");

  const rel = taskRelPath(id);
  writeMarkdown(rel, fm, body);
  return { frontmatter: fm, body, relPath: rel };
}

export function readTask(id: string): Task | null {
  const rel = taskRelPath(id);
  if (!exists(rel)) return null;
  const { frontmatter, body } = readMarkdown<TaskFrontmatter>(rel);
  return { frontmatter, body, relPath: rel };
}

export function updateTask(
  id: string,
  patch: Partial<Omit<TaskFrontmatter, "id" | "created">> & { logEntry?: string },
): Task | null {
  const existing = readTask(id);
  if (!existing) return null;

  const now = toLocalISODateTime();
  const { logEntry, ...fmPatch } = patch;
  const nextFm: TaskFrontmatter = TaskFrontmatter.parse({
    ...existing.frontmatter,
    ...fmPatch,
    updated: now,
  });

  let body = existing.body;
  if (logEntry) {
    const appended = `- ${now.slice(0, 10)} — ${logEntry}`;
    if (/^## Log\s*$/m.test(body)) {
      body = body.replace(/(^## Log\s*$)/m, `$1\n${appended}`);
    } else {
      body += `\n\n## Log\n${appended}\n`;
    }
  }

  writeMarkdown(existing.relPath, nextFm, body);
  return { frontmatter: nextFm, body, relPath: existing.relPath };
}

export type TaskFilter = {
  status?: z.infer<typeof TaskStatus>[];
  project?: string;
  overdueAsOf?: string; // YYYY-MM-DD
  /** Case-insensitive substring match on `waiting_on`. Empty string is ignored. */
  waitingOn?: string;
  /** Only return tasks whose `deadline` is null. */
  noDeadline?: boolean;
};

/**
 * Pure predicate: does this task's frontmatter satisfy the filter?
 *
 * Extracted from `listTasks` so it can be unit-tested without spinning up
 * a temp vault. The I/O orchestration in `listTasks` stays trivial — read
 * each task, run this predicate, keep matches.
 */
export function matchesFilter(fm: TaskFrontmatter, filter?: TaskFilter): boolean {
  if (!filter) return true;
  if (filter.status && !filter.status.includes(fm.status)) return false;
  if (filter.project && fm.project !== filter.project) return false;
  if (filter.overdueAsOf) {
    if (!fm.deadline || fm.deadline >= filter.overdueAsOf) return false;
  }
  if (filter.waitingOn) {
    const needle = filter.waitingOn.trim().toLowerCase();
    if (needle.length > 0) {
      const wo = (fm.waiting_on ?? "").toLowerCase();
      if (!wo.includes(needle)) return false;
    }
  }
  if (filter.noDeadline && fm.deadline) return false;
  return true;
}

export function listTasks(filter?: TaskFilter): Task[] {
  const files = listMarkdown(TASKS_DIR);
  const out: Task[] = [];
  for (const rel of files) {
    const { frontmatter, body } = readMarkdown<TaskFrontmatter>(rel);
    if (!matchesFilter(frontmatter, filter)) continue;
    out.push({ frontmatter, body, relPath: rel });
  }
  return out;
}

/**
 * Delete a task by id. Reads the existing task first so the caller has
 * a snapshot of what was deleted (for receipts, Linear archive, etc.).
 * Returns null if the task doesn't exist. The caller is responsible for
 * git commit + push of the removal.
 */
export function deleteTask(id: string): Task | null {
  const existing = readTask(id);
  if (!existing) return null;
  deleteFile(existing.relPath);
  return existing;
}

export function openTasks(): Task[] {
  return listTasks({ status: ["open", "in_progress", "blocked"] });
}

export function overdueTasks(asOf: string): Task[] {
  return openTasks().filter((t) => t.frontmatter.deadline && t.frontmatter.deadline < asOf);
}
