import cron from "node-cron";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { generateDailyBrief } from "../briefs/daily.js";
import { generateWeeklyReview } from "../briefs/weekly.js";
import { send } from "../messenger/index.js";
import { fitForWhatsappBody } from "../messenger/format.js";
import { db } from "../db/sqlite.js";
import { toLocalISODate, toLocalISODateTime } from "../vault/time.js";
import { overdueTasks } from "../vault/tasks.js";
import { syncPull } from "../vault/client.js";
import { emitDailyCostReport } from "../cost/report.js";

type JobName = "daily_brief" | "weekly_review" | "deadline_sweep" | "daily_cost";

async function withLog<T>(name: JobName, fn: () => Promise<T>): Promise<T | null> {
  const started = toLocalISODateTime();
  const info = db()
    .prepare(
      `INSERT INTO cron_runs (job_name, started_at, status) VALUES (?, ?, 'running')`,
    )
    .run(name, started);
  const id = Number(info.lastInsertRowid);
  try {
    const result = await fn();
    db()
      .prepare(
        `UPDATE cron_runs SET finished_at = ?, status = 'ok' WHERE id = ?`,
      )
      .run(toLocalISODateTime(), id);
    return result;
  } catch (err) {
    logger.error({ err, job: name }, "cron job failed");
    db()
      .prepare(
        `UPDATE cron_runs SET finished_at = ?, status = 'error', notes = ? WHERE id = ?`,
      )
      .run(toLocalISODateTime(), err instanceof Error ? err.message : String(err), id);
    return null;
  }
}

export function startCron(): void {
  cron.schedule(
    config.cron.dailyBrief,
    () =>
      void withLog("daily_brief", async () => {
        const brief = await generateDailyBrief();
        const message = fitForWhatsappBody({
          header: `Daily brief — ${toLocalISODate()}`,
          body: brief.body,
          vaultRel: brief.relPath,
        });
        await send(message, "telegram");
      }),
    { timezone: config.operator.timezone },
  );

  cron.schedule(
    config.cron.weeklyReview,
    () =>
      void withLog("weekly_review", async () => {
        const review = await generateWeeklyReview();
        const message = fitForWhatsappBody({
          header: "Weekly review",
          body: review.body,
          vaultRel: review.relPath,
        });
        await send(message, "telegram");
      }),
    { timezone: config.operator.timezone },
  );

  cron.schedule(
    config.cron.deadlineSweep,
    () =>
      void withLog("deadline_sweep", async () => {
        await syncPull();
        const overdue = overdueTasks(toLocalISODate());
        if (overdue.length === 0) return;
        // v1: just log. Phase 3 will push urgent overdue via WhatsApp.
        logger.warn({ count: overdue.length }, "overdue tasks detected");
      }),
    { timezone: config.operator.timezone },
  );

  // Daily cost summary at 23:59 operator-local. Reads from usage_records,
  // groups by (label, model), prices each, emits one structured `cost.daily`
  // log entry plus a human-readable breakdown. No channel delivery — read
  // via `fly logs` or the operator's preferred log viewer.
  cron.schedule(
    config.cron.dailyCost,
    () =>
      void withLog("daily_cost", async () => {
        emitDailyCostReport();
      }),
    { timezone: config.operator.timezone },
  );

  logger.info(
    {
      dailyBrief: config.cron.dailyBrief,
      weeklyReview: config.cron.weeklyReview,
      deadlineSweep: config.cron.deadlineSweep,
      dailyCost: config.cron.dailyCost,
      tz: config.operator.timezone,
    },
    "cron jobs scheduled",
  );
}
