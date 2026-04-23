import { z } from "zod";
import { config } from "../config.js";

export const ProjectEnum = z.enum(config.operator.projects as [string, ...string[]]);
export type ProjectName = z.infer<typeof ProjectEnum>;

export const TaskType = z.enum(["task", "idea", "reminder", "delegated", "waiting-for"]);
export const TaskStatus = z.enum(["open", "in_progress", "blocked", "done", "dropped"]);
export const Priority = z.enum(["P0", "P1", "P2", "P3"]);

const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const IsoDateTime = z.string().datetime({ offset: true });

// LLMs occasionally emit a bare string where the schema expects a single-element
// array (e.g. tags: "tax" instead of ["tax"]). Accept both.
export const TagList = z.preprocess(
  (v) => (typeof v === "string" ? [v] : v),
  z.array(z.string()).default([]),
);

// Same coercion, but no default — for partial updates where omission must mean
// "leave unchanged" rather than "reset to []".
export const TagListOptional = z.preprocess(
  (v) => (v === undefined ? undefined : typeof v === "string" ? [v] : v),
  z.array(z.string()).optional(),
);

export const TaskFrontmatter = z.object({
  id: z.string().regex(/^T-\d{8}-[a-z0-9-]+$/),
  title: z.string().min(1),
  type: TaskType.default("task"),
  status: TaskStatus.default("open"),
  project: ProjectEnum,
  priority: Priority.default("P2"),
  deadline: IsoDate.nullable().optional(),
  created: IsoDateTime,
  updated: IsoDateTime,
  tags: TagList,
  waiting_on: z.string().nullable().optional(),
  links: TagList,
  source: z.enum(["chat", "whatsapp", "manual", "system", "cli", "http"]).default("manual"),
});
export type TaskFrontmatter = z.infer<typeof TaskFrontmatter>;

export const ProjectFrontmatter = z.object({
  name: ProjectEnum,
  status: z.enum(["active", "paused", "archived"]).default("active"),
  created: IsoDateTime,
  updated: IsoDateTime,
  owner: z.string().default("Craig"),
  summary: z.string().default(""),
});
export type ProjectFrontmatter = z.infer<typeof ProjectFrontmatter>;

export const DecisionFrontmatter = z.object({
  id: z.string().regex(/^D-\d{8}-[a-z0-9-]+$/),
  title: z.string().min(1),
  project: ProjectEnum.optional(),
  decided_on: IsoDate,
  status: z.enum(["proposed", "decided", "reversed"]).default("decided"),
  created: IsoDateTime,
  tags: TagList,
});
export type DecisionFrontmatter = z.infer<typeof DecisionFrontmatter>;

export const DailyBriefFrontmatter = z.object({
  date: IsoDate,
  generated_at: IsoDateTime,
  open_task_count: z.number().int().nonnegative(),
  overdue_count: z.number().int().nonnegative(),
});
export type DailyBriefFrontmatter = z.infer<typeof DailyBriefFrontmatter>;

export const WeeklyReviewFrontmatter = z.object({
  week: z.string().regex(/^\d{4}-W\d{2}$/),
  generated_at: IsoDateTime,
});
export type WeeklyReviewFrontmatter = z.infer<typeof WeeklyReviewFrontmatter>;

export const MeetingFrontmatter = z.object({
  id: z.string().regex(/^M-\d{8}-[a-z0-9-]+$/),
  title: z.string().min(1),
  date: IsoDate,
  project: ProjectEnum.optional(),
  attendees: z.array(z.string()).default([]),
  created: IsoDateTime,
});
export type MeetingFrontmatter = z.infer<typeof MeetingFrontmatter>;
