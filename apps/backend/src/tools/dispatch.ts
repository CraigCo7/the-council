import { z } from "zod";
import { TagListOptional } from "../vault/schemas.js";
import {
  CreateTaskInput,
  createTask,
  listTasks,
  overdueTasks,
  updateTask,
} from "../vault/tasks.js";
import { commitAndPush, syncPull, vaultPath } from "../vault/client.js";
import path from "node:path";
import { enqueue } from "../approvals/queue.js";
import { consultStrategicAnalyst } from "../agents/strategic-analyst.js";
import { toLocalISODate } from "../vault/time.js";
import { logger } from "../logger.js";

export type ToolResult = { content: string; is_error?: boolean };

type Dispatcher = (input: unknown) => Promise<ToolResult>;

const dispatchers: Record<string, Dispatcher> = {
  create_task: async (raw) => {
    const parsed = CreateTaskInput.parse(raw);
    await syncPull();
    const task = createTask(parsed);
    const { committed, hash } = await commitAndPush(
      [path.join(vaultPath(), task.relPath)],
      `task: capture ${task.frontmatter.id} — ${task.frontmatter.title}`,
    );
    return {
      content: JSON.stringify({
        ok: true,
        id: task.frontmatter.id,
        relPath: task.relPath,
        committed,
        hash,
      }),
    };
  },

  update_task: async (raw) => {
    const parsed = z
      .object({
        id: z.string(),
        status: z.enum(["open", "in_progress", "blocked", "done", "dropped"]).optional(),
        priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
        deadline: z.string().nullable().optional(),
        title: z.string().optional(),
        tags: TagListOptional,
        logEntry: z.string().optional(),
      })
      .parse(raw);
    await syncPull();
    const { id, ...patch } = parsed;
    const updated = updateTask(id, patch);
    if (!updated) {
      return { content: JSON.stringify({ ok: false, error: "task not found", id }), is_error: true };
    }
    const { committed, hash } = await commitAndPush(
      [path.join(vaultPath(), updated.relPath)],
      `task: update ${updated.frontmatter.id}`,
    );
    return { content: JSON.stringify({ ok: true, id, committed, hash }) };
  },

  list_tasks: async (raw) => {
    const parsed = z
      .object({
        project: z.string().optional(),
        status: z
          .array(z.enum(["open", "in_progress", "blocked", "done", "dropped"]))
          .optional(),
      })
      .parse(raw);
    await syncPull();
    const filter: { project?: string; status?: Array<"open" | "in_progress" | "blocked" | "done" | "dropped"> } = {};
    if (parsed.project) filter.project = parsed.project;
    if (parsed.status) filter.status = parsed.status;
    const tasks = listTasks(filter);
    return {
      content: JSON.stringify(
        tasks.map((t) => ({
          id: t.frontmatter.id,
          title: t.frontmatter.title,
          project: t.frontmatter.project,
          priority: t.frontmatter.priority,
          status: t.frontmatter.status,
          deadline: t.frontmatter.deadline ?? null,
          type: t.frontmatter.type,
        })),
      ),
    };
  },

  list_overdue: async () => {
    await syncPull();
    const today = toLocalISODate();
    const tasks = overdueTasks(today);
    return {
      content: JSON.stringify(
        tasks.map((t) => ({
          id: t.frontmatter.id,
          title: t.frontmatter.title,
          project: t.frontmatter.project,
          priority: t.frontmatter.priority,
          deadline: t.frontmatter.deadline,
          days_overdue: t.frontmatter.deadline
            ? Math.floor(
                (Date.parse(today) - Date.parse(t.frontmatter.deadline)) / 86400000,
              )
            : null,
        })),
      ),
    };
  },

  propose_approval: async (raw) => {
    const parsed = z
      .object({
        operation: z.enum(["delete_task", "bulk_update", "overwrite_file"]),
        summary: z.string(),
        payload: z.unknown(),
        diff_preview: z.string().optional(),
      })
      .parse(raw);
    const id = enqueue({
      operation: parsed.operation,
      summary: parsed.summary,
      payload: parsed.payload,
      diff_preview: parsed.diff_preview,
    });
    return {
      content: JSON.stringify({
        ok: true,
        approval_id: id,
        message: `Queued approval #${id} — approve via 'council approve ${id}' or the /approvals endpoint.`,
      }),
    };
  },

  consult_strategic_analyst: async (raw) => {
    const parsed = z
      .object({ topic: z.string(), context: z.string() })
      .parse(raw);
    const analysis = await consultStrategicAnalyst(parsed);
    return { content: analysis };
  },
};

export async function dispatchTool(name: string, input: unknown): Promise<ToolResult> {
  const fn = dispatchers[name];
  if (!fn) {
    return { content: `unknown tool: ${name}`, is_error: true };
  }
  try {
    return await fn(input);
  } catch (err) {
    logger.error({ err, name, input }, "tool dispatch failed");
    const msg = err instanceof Error ? err.message : String(err);
    return { content: JSON.stringify({ ok: false, error: msg }), is_error: true };
  }
}

