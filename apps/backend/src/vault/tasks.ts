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
import { exists, listMarkdown, readMarkdown, slugify, writeMarkdown } from "./fs.js";
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

export function listTasks(filter?: {
  status?: z.infer<typeof TaskStatus>[];
  project?: string;
  overdueAsOf?: string; // YYYY-MM-DD
}): Task[] {
  const files = listMarkdown(TASKS_DIR);
  const out: Task[] = [];
  for (const rel of files) {
    const { frontmatter, body } = readMarkdown<TaskFrontmatter>(rel);
    if (filter?.status && !filter.status.includes(frontmatter.status)) continue;
    if (filter?.project && frontmatter.project !== filter.project) continue;
    if (filter?.overdueAsOf && frontmatter.deadline && frontmatter.deadline < filter.overdueAsOf) {
      // overdue
    } else if (filter?.overdueAsOf) {
      continue;
    }
    out.push({ frontmatter, body, relPath: rel });
  }
  return out;
}

export function openTasks(): Task[] {
  return listTasks({ status: ["open", "in_progress", "blocked"] });
}

export function overdueTasks(asOf: string): Task[] {
  return openTasks().filter((t) => t.frontmatter.deadline && t.frontmatter.deadline < asOf);
}
