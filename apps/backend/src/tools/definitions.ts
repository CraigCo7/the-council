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
      description: "Update an existing task by id. Use for status changes, deadline bumps, log entries, re-prioritizations of a single task.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Task id like T-20260423-foo." },
          status: {
            type: "string",
            enum: ["open", "in_progress", "blocked", "done", "dropped"],
          },
          priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
          deadline: { type: ["string", "null"] },
          title: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
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
      description: "List open tasks, optionally filtered by project or status.",
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
        },
      },
    },
    {
      name: "list_overdue",
      description: "List all open tasks with a deadline before today.",
      input_schema: { type: "object", properties: {} },
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
