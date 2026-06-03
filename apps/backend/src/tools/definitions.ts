import type Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

/**
 * Tool schemas exposed to Chief of Staff.
 * Implementations live in `tools/dispatch.ts`.
 */
export function toolDefinitions(): Anthropic.Tool[] {
  const projectEnum = config.operator.projects;

  return [
    {
      name: "create_task",
      description:
        "Capture a new task, idea, reminder, delegated item, or waiting-for. Use aggressively — any actionable input should become a task rather than live only in the chat.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short imperative title." },
          project: { type: "string", enum: projectEnum },
          type: {
            type: "string",
            enum: ["task", "idea", "reminder", "delegated", "waiting-for"],
            default: "task",
          },
          priority: {
            type: "string",
            enum: ["P0", "P1", "P2", "P3"],
            default: "P2",
          },
          deadline: {
            type: ["string", "null"],
            description: "ISO date YYYY-MM-DD, or null.",
          },
          tags: { type: "array", items: { type: "string" }, default: [] },
          waiting_on: {
            type: ["string", "null"],
            description: "Required if type='waiting-for'.",
          },
          context: {
            type: "string",
            description: "Free-form context to store in the task body.",
            default: "",
          },
        },
        required: ["title", "project"],
      },
    },
    {
      name: "update_task",
      description: "Update an existing task by id. Use for status changes, deadline bumps, log entries, re-prioritizations, project moves, and waiting-on changes.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Task id like T-20260423-foo." },
          status: {
            type: "string",
            enum: ["open", "in_progress", "blocked", "done", "dropped"],
          },
          priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
          project: {
            type: "string",
            enum: projectEnum,
            description: "Move the task to a different project bucket.",
          },
          type: {
            type: "string",
            enum: ["task", "idea", "reminder", "delegated", "waiting-for"],
            description: "Reclassify the task (e.g. task → reminder, or task → waiting-for).",
          },
          deadline: { type: ["string", "null"] },
          title: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          waiting_on: {
            type: ["string", "null"],
            description: "Required when type='waiting-for'; null clears it.",
          },
          logEntry: {
            type: "string",
            description: "Human log line appended under ## Log, e.g. 'sent draft to lawyer'.",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "list_tasks",
      description:
        "List tasks, optionally filtered by project, status, the person they're waiting on, or whether they have no deadline. Use `waiting_on` for queries like \"what is Christian doing\" or \"what am I waiting on from Jake\" — the match is a case-insensitive substring against the task's waiting_on field, so partial names work.",
      input_schema: {
        type: "object",
        properties: {
          project: { type: "string", enum: projectEnum },
          status: {
            type: "array",
            items: {
              type: "string",
              enum: ["open", "in_progress", "blocked", "done", "dropped"],
            },
          },
          waiting_on: {
            type: "string",
            description:
              "Case-insensitive substring match on the waiting_on field. Use the operator's wording (e.g. 'chris' matches 'Christian').",
          },
          no_deadline: {
            type: "boolean",
            description: "When true, only return tasks whose deadline is null.",
          },
        },
      },
    },
    {
      name: "list_overdue",
      description: "List all open tasks with a deadline before today.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "delete_task",
      description:
        "Drop / delete a single task by id. Removes the markdown file from the vault and archives the corresponding Linear issue (soft delete — recoverable from Linear UI). For \"drop the X task\" / \"delete the Y reminder\" / \"forget that\" intent. Resolve the id via list_tasks first if the operator referenced the task by description.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Task id like T-20260423-foo." },
        },
        required: ["id"],
      },
    },
    {
      name: "read_project",
      description:
        "Read a project file from the vault — returns its frontmatter (status, summary, owner, created, updated) and its body Markdown (North star, Current focus, Blockers, Key people, Links sections). Use this BEFORE calling `update_project` when the operator describes a delta ('remove X, add Y') and you need to know the current state to compose the new full value.",
      input_schema: {
        type: "object",
        properties: {
          project: { type: "string", enum: projectEnum },
        },
        required: ["project"],
      },
    },
    {
      name: "update_project",
      description:
        "Update a project's metadata or body sections in the vault, and mirror the change into the corresponding Linear project's description. Use for personnel changes (key_people), status changes (active/paused/archived), or revisions to a project's north star / current focus / blockers / links. Pass only the fields you want to change; everything else is untouched. The system synthesizes a `✓ Project updated: ...` receipt from real tool data, so do NOT write that line yourself.",
      input_schema: {
        type: "object",
        properties: {
          project: { type: "string", enum: projectEnum },
          status: {
            type: "string",
            enum: ["active", "paused", "archived"],
            description: "Project lifecycle status (frontmatter).",
          },
          summary: {
            type: "string",
            description: "One-line project summary (frontmatter).",
          },
          north_star: {
            type: "string",
            description: "Body of the `## North star` section. Markdown.",
          },
          current_focus: {
            type: "string",
            description: "Body of the `## Current focus` section. Markdown.",
          },
          blockers: {
            type: "string",
            description: "Body of the `## Blockers` section. Markdown.",
          },
          key_people: {
            type: "array",
            description:
              "Replaces the `## Key people` section. Structured — the system renders the bullets, you don't.",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                role: { type: "string", description: "Optional role/title, e.g. 'Project Engineer'." },
              },
              required: ["name"],
            },
          },
          links: {
            type: "string",
            description: "Body of the `## Links` section. Markdown.",
          },
        },
        required: ["project"],
      },
    },
    {
      name: "propose_approval",
      description:
        "Enqueue a destructive operation (delete, bulk update, overwrite) for operator approval. Returns an approval id.",
      input_schema: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: ["delete_task", "bulk_update", "overwrite_file"],
          },
          summary: {
            type: "string",
            description: "One-line description shown to the operator.",
          },
          payload: {
            type: "object",
            description: "Operation-specific arguments. See docs/APPROVALS.md.",
          },
          diff_preview: { type: "string" },
        },
        required: ["operation", "summary", "payload"],
      },
    },
    {
      name: "consult_strategic_analyst",
      description:
        "Invoke the Strategic Analyst for pressure-testing a decision, plan, or commitment. Use when stakes are meaningful — not for trivial inputs.",
      input_schema: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "One-line statement of what's being decided or proposed.",
          },
          context: {
            type: "string",
            description: "Full context the analyst needs — prior rationale, constraints, alternatives considered.",
          },
        },
        required: ["topic", "context"],
      },
    },
  ];
}
