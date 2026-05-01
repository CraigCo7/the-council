import path from "node:path";
import { anthropic, defaultsFor, logUsage } from "../llm/anthropic.js";
import { commitAndPush, syncPull, vaultPath } from "../vault/client.js";
import { writeMarkdown } from "../vault/fs.js";
import { openTasks } from "../vault/tasks.js";
import { toLocalISODate, toLocalISODateTime } from "../vault/time.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const BRIEFS_DIR = "09-Briefs";

const SYSTEM = `You are drafting the daily operator brief for {{name}}. Be terse, structured, operational.

Format:
# Daily Brief — {{date}}

## Today
- Most important thing: one line.
- What moves the needle: 1–3 bullets.

## Deadlines
- Due today / overdue: bullets with project tag.

## Open ({{open_count}}) — by project
- One bullet per project. Top 2–3 items only. Skip empty projects.

## Operator note
- One-line recommendation or challenge. Push if the operator is overcommitting or repeating patterns.

Hard rules: no fluff, no "you got this", no emojis. If there is nothing to say in a section, omit it.`;

export async function generateDailyBrief(): Promise<{ relPath: string; body: string }> {
  await syncPull();

  const today = toLocalISODate();
  const tasks = openTasks();
  const overdue = tasks.filter((t) => t.frontmatter.deadline && t.frontmatter.deadline < today);
  const dueToday = tasks.filter((t) => t.frontmatter.deadline === today);

  const defaults = defaultsFor("brief");
  const system = SYSTEM.replaceAll("{{name}}", config.operator.name)
    .replaceAll("{{date}}", today)
    .replaceAll("{{open_count}}", String(tasks.length));

  const taskSnapshot = tasks
    .map((t) => {
      const fm = t.frontmatter;
      return `- [${fm.priority}] ${fm.title} — ${fm.project}${fm.deadline ? ` (due ${fm.deadline})` : ""} <${fm.id}>`;
    })
    .join("\n");

  const response = await anthropic.messages.create({
    ...defaults,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `Today: ${today}\nOverdue: ${overdue.length}\nDue today: ${dueToday.length}\nOpen tasks: ${tasks.length}\n\n${taskSnapshot || "(no open tasks)"}`,
      },
    ],
  });
  logUsage("daily-brief", defaults.model, response.usage);

  const llmBody = response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n")
    .trim();

  const rel = path.posix.join(BRIEFS_DIR, `${today}.md`);
  writeMarkdown(
    rel,
    {
      date: today,
      generated_at: toLocalISODateTime(),
      open_task_count: tasks.length,
      overdue_count: overdue.length,
    },
    llmBody,
  );

  const { committed } = await commitAndPush(
    [path.join(vaultPath(), rel)],
    `brief: daily ${today}`,
  );
  if (committed) logger.info({ rel }, "daily brief committed");

  return { relPath: rel, body: llmBody };
}
