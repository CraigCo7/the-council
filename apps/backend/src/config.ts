import "dotenv/config";
import { z } from "zod";

const ConfigSchema = z.object({
  anthropic: z.object({
    apiKey: z.string().min(1, "ANTHROPIC_API_KEY is required"),
    models: z.object({
      // Routine = Chief of Staff router. Sonnet 4.6 over Haiku 4.5 because:
      // (1) better tool-use routing, (2) prompt caching activates on prompts
      // >= 2048 tokens (Haiku requires >= 4096) so the cost gap collapses
      // after the first request in a cache window.
      routine: z.string().default("claude-sonnet-4-6"),
      brief: z.string().default("claude-sonnet-4-6"),
      strategic: z.string().default("claude-opus-4-7"),
    }),
  }),
  vault: z.object({
    path: z.string().default("./vault"),
    remote: z.string().min(1, "VAULT_REMOTE is required"),
    branch: z.string().default("main"),
    gitUserName: z.string().default("The Council"),
    gitUserEmail: z.string().default("council-bot@users.noreply.github.com"),
  }),
  server: z.object({
    host: z.string().default("0.0.0.0"),
    port: z.coerce.number().int().positive().default(8080),
    intakeToken: z.string().min(16, "INTAKE_TOKEN must be at least 16 chars"),
  }),
  operator: z.object({
    name: z.string().default("Operator"),
    timezone: z.string().default("Asia/Manila"),
    projects: z.array(z.string()).min(1),
  }),
  cron: z.object({
    dailyBrief: z.string().default("0 7 * * *"),
    weeklyReview: z.string().default("0 18 * * 0"),
    deadlineSweep: z.string().default("0 * * * *"),
    // Daily Anthropic-cost summary, emitted to logs only. Default 23:59 in
    // operator timezone — captures the full day before the calendar rolls.
    dailyCost: z.string().default("59 23 * * *"),
  }),
  db: z.object({
    path: z.string().default("./data/council.sqlite"),
  }),
  log: z.object({
    level: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  }),
  whatsapp: z.object({
    enabled: z.coerce.boolean().default(false),
    phoneNumberId: z.string().default(""),
    accessToken: z.string().default(""),
    verifyToken: z.string().default(""),
    // App secret for verifying X-Hub-Signature-256 on inbound webhooks.
    // Without this, anyone could POST to /webhooks/whatsapp and the system
    // would happily run agent loops on their input.
    appSecret: z.string().default(""),
    toNumber: z.string().default(""),
  }),
  telegram: z.object({
    enabled: z.coerce.boolean().default(false),
    // Bot token from @BotFather, format `<botid>:<hash>`.
    botToken: z.string().default(""),
    // Numeric chat ID — only this chat is processed; everything else is dropped.
    // Get it via getUpdates after sending a first message to the bot.
    chatId: z.string().default(""),
    // Random string passed to setWebhook → Telegram echoes it back on every
    // request via X-Telegram-Bot-Api-Secret-Token header. The webhook
    // equivalent of HMAC for Telegram (Telegram does not sign payloads).
    webhookSecret: z.string().default(""),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const raw = {
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY ?? "",
      models: {
        routine: process.env.MODEL_ROUTINE,
        brief: process.env.MODEL_BRIEF,
        strategic: process.env.MODEL_STRATEGIC,
      },
    },
    vault: {
      path: process.env.VAULT_PATH,
      remote: process.env.VAULT_REMOTE ?? "",
      branch: process.env.VAULT_BRANCH,
      gitUserName: process.env.VAULT_GIT_USER_NAME,
      gitUserEmail: process.env.VAULT_GIT_USER_EMAIL,
    },
    server: {
      host: process.env.HOST,
      port: process.env.PORT,
      intakeToken: process.env.INTAKE_TOKEN ?? "",
    },
    operator: {
      name: process.env.OPERATOR_NAME,
      timezone: process.env.OPERATOR_TIMEZONE,
      projects: (process.env.PROJECTS ?? "BidaWash,Puppery,ATIN,YNG,Personal")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    },
    cron: {
      dailyBrief: process.env.CRON_DAILY_BRIEF,
      weeklyReview: process.env.CRON_WEEKLY_REVIEW,
      deadlineSweep: process.env.CRON_DEADLINE_SWEEP,
      dailyCost: process.env.CRON_DAILY_COST,
    },
    db: { path: process.env.DB_PATH },
    log: { level: process.env.LOG_LEVEL as Config["log"]["level"] | undefined },
    whatsapp: {
      enabled: process.env.WHATSAPP_ENABLED,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
      verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
      appSecret: process.env.WHATSAPP_APP_SECRET,
      toNumber: process.env.WHATSAPP_TO_NUMBER,
    },
    telegram: {
      enabled: process.env.TELEGRAM_ENABLED,
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
      webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
    },
  };

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    console.error("Invalid configuration:");
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
