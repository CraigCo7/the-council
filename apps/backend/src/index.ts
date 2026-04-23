import Fastify from "fastify";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { registerRoutes } from "./intake/http.js";
import { startCron } from "./jobs/cron.js";
import { db, closeDb } from "./db/sqlite.js";

async function main(): Promise<void> {
  // Initialize SQLite + migrations.
  db();

  const app = Fastify({ logger: false });
  await registerRoutes(app);
  startCron();

  try {
    await app.listen({ host: config.server.host, port: config.server.port });
    logger.info(
      { host: config.server.host, port: config.server.port },
      "the council is listening",
    );
  } catch (err) {
    logger.error({ err }, "server failed to start");
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    await app.close();
    closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "fatal");
  process.exit(1);
});
