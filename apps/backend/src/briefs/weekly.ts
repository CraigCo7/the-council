import path from "node:path";
import { anthropic, defaultsFor, logUsage } from "../llm/anthropic.js";
import { commitAndPush, syncPull, vaultPath } from "../vault/client.js";
import { writeMarkdown } from "../vault/fs.js";
import { listTasks } from "../vault/tasks.js";
import { toLocalISODate, toLocalISODateTime, toLocalISOWeek } from "../vault/time.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const WEEKLY_DIR = "04-Weekly";

const SYSTEM = `You are drafting {{name}}'s weekly operator review. Analytical, direct, no sycophancy.

# Weekly Review — {{week}}

## Wins / movement
- What actually got done. Be specific. If there's little, say so.

## What slipped
- Tasks that missed deadlines or sat untouched. Name them.

## Project status
- One line per project with open activity. Where it's moving, where it's stalled.

## Decisions needed
- Call out pending decisions implied by blocked or P0/P1 tasks.

## Reprioritization suggestions
- Concrete: "move T-xxx to P3", "drop T-yyy", "bump T-zzz deadline to <date>". Never execute — suggest only.

## Hard truth
- The one thing the operator needs to hear. Aggressive but grounded in the data above. One paragraph max.

Hard rules: cite task ids when relevant. No filler. No advice disconnected from the data.`;

export async function generateWeeklyReview(): Promise<{ relPath: string; body: string }> {
  await syncPull();

  const today = toLocalISODate();
  const week = toLocalISOWeek();
  const allTasks = listTasks();

  const done = allTasks.filter((t) => t.frontmatter.status === "done");
  const slipped = allTasks.filter(
    (t) =>
      t.frontmatter.deadline &&
      t.frontmatter.deadline < today &&
      t.frontmatter.status !== "done" &&
      t.frontmatter.status !== "dropped",
  );
  const blocked = allTasks.filter((t) => t.frontmatter.status === "blocked");

  const snapshot = (label: string, xs: typeof allTasks) =>
    `## ${label} (${xs.length})\n` +
    xs
      .map(
        (t) =>
          `- [${t.frontmatter.priority}] ${t.frontmatter.title} — ${t.frontmatter.project}${t.frontmatter.deadline ? ` (due ${t.frontmatter.deadline})` : ""} <${t.frontmatter.id}>`,
      )
      .join("\n");

  const defaults = defaultsFor("strategic");
  const system = SYSTEM.replaceAll("{{name}}", config.operator.name).replaceAll("{{week}}", week);

  const response = await anthropic.messages.create({
    ...defaults,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          `Week: ${week}`,
          `Today: ${today}`,
          "",
          snapshot("Open", allTasks.filter((t) => t.frontmatter.status !== "done" && t.frontmatter.status !== "dropped")),
          "",
          snapshot("Done", done),
          "",
          snapshot("Slipped (overdue, not done)", slipped),
          "",
          snapshot("Blocked", blocked),
        ].join("\n"),
      },
    ],
  });
  logUsage("weekly-review", response.usage);

  const body = response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n")
    .trim();

  const rel = path.posix.join(WEEKLY_DIR, `${week}.md`);
  writeMarkdown(rel, { week, generated_at: toLocalISODateTime() }, body);

  const { committed } = await commitAndPush(
    [path.join(vaultPath(), rel)],
    `brief: weekly review ${week}`,
  );
  if (committed) logger.info({ rel }, "weekly review committed");

  return { relPath: rel, body };
}
