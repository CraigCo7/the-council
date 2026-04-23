import { anthropic, defaultsFor, logUsage } from "../llm/anthropic.js";
import { loadPrompt } from "./prompt-loader.js";
import { openTasks } from "../vault/tasks.js";
import { toLocalISODate } from "../vault/time.js";

export type SignalSummary = {
  text: string;
  openCount: number;
  overdueCount: number;
};

/**
 * v1 surfaces state directly from the vault — no external news sources yet.
 * Summarized by Sonnet 4.6 with a tight system prompt.
 */
export async function surfaceSignals(): Promise<SignalSummary> {
  const today = toLocalISODate();
  const tasks = openTasks();
  const overdue = tasks.filter((t) => t.frontmatter.deadline && t.frontmatter.deadline < today);

  const taskTable = tasks
    .map((t) => {
      const fm = t.frontmatter;
      return `| ${fm.id} | ${fm.project} | ${fm.priority} | ${fm.status} | ${fm.deadline ?? "—"} | ${fm.type} | ${fm.title} |`;
    })
    .join("\n");

  const defaults = defaultsFor("brief");
  const response = await anthropic.messages.create({
    ...defaults,
    system: [
      {
        type: "text",
        text: loadPrompt("intelligence-monitor"),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Today: ${today}\n\n| id | project | priority | status | deadline | type | title |\n|---|---|---|---|---|---|---|\n${taskTable || "(no open tasks)"}`,
      },
    ],
  });

  logUsage("intelligence-monitor", response.usage);

  const text = response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n");

  return { text, openCount: tasks.length, overdueCount: overdue.length };
}
