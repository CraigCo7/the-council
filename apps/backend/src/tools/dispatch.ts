import { z } from "zod";
import { ProjectEnum, TagListOptional, TaskType } from "../vault/schemas.js";
import {
  CreateTaskInput,
  createTask,
  deleteTask,
  listTasks,
  overdueTasks,
  updateTask,
} from "../vault/tasks.js";
import { commitAndPush, syncPull, vaultPath } from "../vault/client.js";
import path from "node:path";
import { enqueue } from "../approvals/queue.js";
import { consultStrategicAnalyst } from "../agents/strategic-analyst.js";
import { toLocalISODate } from "../vault/time.js";
import { listLinearIssues } from "../linear/listIssues.js";
import { createLinearIssue, shouldMirrorToLinear } from "../linear/createIssue.js";
import { updateLinearIssue } from "../linear/updateIssue.js";
import { archiveLinearIssue } from "../linear/archiveIssue.js";
import { updateLinearProject } from "../linear/updateProject.js";
import { linearEnabled } from "../linear/client.js";
import {
  UpdateProjectInput,
  changedFields,
  readProject,
  renderedBodySections,
  updateProject,
} from "../vault/projects.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

export type ToolResult = { content: string; is_error?: boolean };

type Dispatcher = (input: unknown) => Promise<ToolResult>;

const dispatchers: Record<string, Dispatcher> = {
  create_task: async (raw) => {
    const parsed = CreateTaskInput.parse(raw);
    await syncPull();
    let task = createTask(parsed);

    // Mirror to Linear when the type is actionable. Vault is canonical;
    // Linear failures are non-fatal — we keep the vault task and surface
    // the failure as a `linear_warning` so the agent can flag it in
    // commentary if it wants.
    let linearWarning: string | null = null;
    if (linearEnabled() && shouldMirrorToLinear(task.frontmatter.type)) {
      const result = await createLinearIssue({
        title: parsed.title,
        type: parsed.type,
        project: parsed.project,
        priority: parsed.priority,
        deadline: parsed.deadline ?? null,
        waiting_on: parsed.waiting_on ?? null,
        context: parsed.context,
      });
      if (result.ok) {
        // Write the cross-reference back into the vault frontmatter.
        // The same file gets re-rendered; commitAndPush below picks up
        // the cumulative state in one commit.
        const updated = updateTask(task.frontmatter.id, {
          linear_id: result.identifier,
          linear_url: result.url,
        });
        if (updated) task = updated;
      } else {
        linearWarning = result.error;
        logger.warn(
          { id: task.frontmatter.id, error: result.error },
          "linear mirror failed — vault task created without cross-ref",
        );
      }
    }

    const { committed, hash } = await commitAndPush(
      [path.join(vaultPath(), task.relPath)],
      `task: capture ${task.frontmatter.id} — ${task.frontmatter.title}`,
    );
    // The `task` field is consumed by the receipt synthesizer in
    // chief-of-staff.ts to produce `✓ Captured: ...` from real data.
    // Including the full frontmatter snapshot makes the receipt
    // trustworthy regardless of what the model would have written.
    return {
      content: JSON.stringify({
        ok: true,
        id: task.frontmatter.id,
        relPath: task.relPath,
        committed,
        hash,
        task: task.frontmatter,
        linear_warning: linearWarning,
      }),
    };
  },

  update_task: async (raw) => {
    const parsed = z
      .object({
        id: z.string(),
        status: z.enum(["open", "in_progress", "blocked", "done", "dropped"]).optional(),
        priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
        project: ProjectEnum.optional(),
        type: TaskType.optional(),
        deadline: z.string().nullable().optional(),
        title: z.string().optional(),
        tags: TagListOptional,
        waiting_on: z.string().nullable().optional(),
        logEntry: z.string().optional(),
      })
      .parse(raw);
    await syncPull();
    const { id, ...patch } = parsed;
    const updated = updateTask(id, patch);
    if (!updated) {
      return { content: JSON.stringify({ ok: false, error: "task not found", id }), is_error: true };
    }
    // Propagate the patch to Linear if the vault task has a cross-ref.
    // Same non-fatal posture as create: vault is canonical, Linear failures
    // are surfaced as `linear_warning` for the agent to flag.
    let linearWarning: string | null = null;
    if (linearEnabled() && updated.frontmatter.linear_id) {
      const result = await updateLinearIssue(
        updated.frontmatter.linear_id,
        {
          title: parsed.title,
          status: parsed.status,
          priority: parsed.priority,
          deadline: parsed.deadline ?? undefined,
          project: parsed.project,
          // Only forward waiting_on when the operator explicitly passed it
          // (undefined means "leave unchanged").
          waitingOnReplace:
            parsed.waiting_on !== undefined ? parsed.waiting_on : undefined,
          logEntry: parsed.logEntry,
        },
        config.operator.teamMembers,
      );
      if (!result.ok) {
        linearWarning = result.error;
        logger.warn(
          { id: updated.frontmatter.id, linear_id: updated.frontmatter.linear_id, error: result.error },
          "linear update failed — vault still committed",
        );
      }
    }

    const { committed, hash } = await commitAndPush(
      [path.join(vaultPath(), updated.relPath)],
      `task: update ${updated.frontmatter.id}`,
    );
    // The `task` field carries the post-update frontmatter so the receipt
    // synthesizer can render `✓ Updated: <title> [<project> · ...]` from
    // the new state, not whatever the model thought happened.
    return {
      content: JSON.stringify({
        ok: true,
        id,
        committed,
        hash,
        task: updated.frontmatter,
        linear_warning: linearWarning,
      }),
    };
  },

  list_tasks: async (raw) => {
    const parsed = z
      .object({
        project: z.string().optional(),
        status: z
          .array(z.enum(["open", "in_progress", "blocked", "done", "dropped"]))
          .optional(),
        waiting_on: z.string().optional(),
        no_deadline: z.boolean().optional(),
      })
      .parse(raw);
    await syncPull();
    const filter: {
      project?: string;
      status?: Array<"open" | "in_progress" | "blocked" | "done" | "dropped">;
      waitingOn?: string;
      noDeadline?: boolean;
    } = {};
    if (parsed.project) filter.project = parsed.project;
    if (parsed.status) filter.status = parsed.status;
    if (parsed.waiting_on) filter.waitingOn = parsed.waiting_on;
    if (parsed.no_deadline) filter.noDeadline = parsed.no_deadline;
    // If the operator didn't specify status, default to open work — anything
    // closed is rarely what "what's X doing" or "no deadline" queries want.
    if (!parsed.status) filter.status = ["open", "in_progress", "blocked"];

    // Fetch from both sources in parallel. Linear returns [] if disabled
    // or if the API errored — vault results still flow through.
    const [vaultTasks, linearRows] = await Promise.all([
      Promise.resolve(listTasks(filter)),
      listLinearIssues({
        project: filter.project,
        status: filter.status,
        waitingOn: filter.waitingOn,
        noDeadline: filter.noDeadline,
      }),
    ]);

    const vaultRows = vaultTasks.map((t) => ({
      source: "vault" as const,
      id: t.frontmatter.id,
      title: t.frontmatter.title,
      project: t.frontmatter.project,
      priority: t.frontmatter.priority,
      status: t.frontmatter.status,
      deadline: t.frontmatter.deadline ?? null,
      type: t.frontmatter.type,
      waiting_on: t.frontmatter.waiting_on ?? null,
      url: null as string | null,
    }));

    return { content: JSON.stringify([...vaultRows, ...linearRows]) };
  },

  delete_task: async (raw) => {
    const parsed = z.object({ id: z.string() }).parse(raw);
    await syncPull();
    // Snapshot before delete so the receipt has data to render. The
    // Task object includes `frontmatter` (title, project, etc.) and
    // `linear_id` for Linear archive.
    const deleted = deleteTask(parsed.id);
    if (!deleted) {
      return {
        content: JSON.stringify({ ok: false, error: "task not found", id: parsed.id }),
        is_error: true,
      };
    }

    // Archive the Linear counterpart, if any. Vault is canonical; Linear
    // archive failure is logged + surfaced but doesn't fail the delete.
    let linearWarning: string | null = null;
    if (linearEnabled() && deleted.frontmatter.linear_id) {
      const result = await archiveLinearIssue(deleted.frontmatter.linear_id);
      if (!result.ok) {
        linearWarning = result.error;
        logger.warn(
          { id: deleted.frontmatter.id, linear_id: deleted.frontmatter.linear_id, error: result.error },
          "linear archive failed — vault delete still committed",
        );
      }
    }

    const { committed, hash } = await commitAndPush(
      [path.join(vaultPath(), deleted.relPath)],
      `task: drop ${deleted.frontmatter.id} — ${deleted.frontmatter.title}`,
    );
    return {
      content: JSON.stringify({
        ok: true,
        id: deleted.frontmatter.id,
        committed,
        hash,
        // The receipt synthesizer reads `task` to render `✓ Dropped: ...`.
        // Same field name as create/update so receiptFor can handle all three.
        task: deleted.frontmatter,
        linear_warning: linearWarning,
      }),
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

  read_project: async (raw) => {
    const parsed = z.object({ project: ProjectEnum }).parse(raw);
    await syncPull();
    const project = readProject(parsed.project);
    if (!project) {
      return {
        content: JSON.stringify({
          ok: false,
          error: "project file not found",
          project: parsed.project,
        }),
        is_error: true,
      };
    }
    return {
      content: JSON.stringify({
        ok: true,
        project: parsed.project,
        frontmatter: project.frontmatter,
        body: project.body,
      }),
    };
  },

  update_project: async (raw) => {
    const parsed = UpdateProjectInput.parse(raw);
    await syncPull();
    const updated = updateProject(parsed);
    if (!updated) {
      return {
        content: JSON.stringify({
          ok: false,
          error: "project file not found",
          project: parsed.project,
        }),
        is_error: true,
      };
    }

    // Mirror the same set of section patches into Linear's project
    // description. Same non-fatal posture as the issue mirror: vault is
    // canonical, Linear failure surfaces as `linear_warning` and the agent
    // can flag it in commentary. Frontmatter-only patches (status, summary)
    // produce no sections — Linear is left alone in that case.
    let linearWarning: string | null = null;
    let linearUrl: string | null = null;
    if (linearEnabled()) {
      const sections = renderedBodySections(parsed);
      const result = await updateLinearProject(parsed.project, sections);
      if (result.ok) {
        linearUrl = result.url;
      } else {
        linearWarning = result.error;
        logger.warn(
          { project: parsed.project, error: result.error },
          "linear project mirror failed — vault still committed",
        );
      }
    }

    const { committed, hash } = await commitAndPush(
      [path.join(vaultPath(), updated.relPath)],
      `project: update ${parsed.project}`,
    );

    // The `project` and `fields` payload powers the receipt synthesizer in
    // chief-of-staff.ts (`✓ Project updated: <Project> [<fields>] [Linear](url)`).
    return {
      content: JSON.stringify({
        ok: true,
        project: parsed.project,
        fields: changedFields(parsed),
        committed,
        hash,
        linear_url: linearUrl,
        linear_warning: linearWarning,
      }),
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

