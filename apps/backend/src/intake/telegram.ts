import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config.js";
import { db } from "../db/sqlite.js";
import { logger } from "../logger.js";
import { runChiefOfStaff } from "../agents/chief-of-staff.js";
import { sendTelegram } from "../messenger/telegram.js";
import { toLocalISODateTime } from "../vault/time.js";

/**
 * Telegram update payload, narrowed to the bits we act on. Telegram sends
 * a single update per webhook (unlike Meta's batched `messages[]` array).
 * Non-text updates (edits, callback queries, channel posts, etc.) are
 * ignored without erroring.
 */
const TelegramTextMessage = z.object({
  message_id: z.number().int(),
  from: z.object({ id: z.number().int(), first_name: z.string().optional() }).optional(),
  chat: z.object({ id: z.number().int(), type: z.string() }),
  text: z.string(),
});
type TelegramTextMessage = z.infer<typeof TelegramTextMessage>;

const TelegramUpdate = z
  .object({
    update_id: z.number().int(),
    message: z.unknown().optional(),
  })
  .passthrough();

export type ExtractedTelegramMessage = {
  updateId: number;
  message: TelegramTextMessage;
};

/**
 * Pull a text message out of a Telegram update payload.
 * Returns null for status-only / non-text / malformed updates.
 */
export function extractTelegramMessage(payload: unknown): ExtractedTelegramMessage | null {
  const parsed = TelegramUpdate.safeParse(payload);
  if (!parsed.success) return null;
  const msgParsed = TelegramTextMessage.safeParse(parsed.data.message);
  if (!msgParsed.success) return null;
  return { updateId: parsed.data.update_id, message: msgParsed.data };
}

/**
 * Telegram sends the secret as a header on every webhook request. Constant-
 * time string compare to avoid timing oracles. The shared-secret model is
 * weaker than HMAC (no per-payload signing), so the secret should be high
 * entropy and only ever transit over HTTPS.
 */
export function verifyTelegramSecret(provided: string | undefined, expected: string): boolean {
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;
  // Manual constant-time compare — avoids importing crypto for one helper.
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export function isExpectedChat(chatId: number | string): boolean {
  const expected = String(config.telegram.chatId).trim();
  return expected.length > 0 && expected === String(chatId);
}

/**
 * Mark a Telegram update as processed. Returns true if first time seen.
 * Reuses the same `processed_webhook_events` table as WhatsApp; we prefix
 * the external_id with `tg-` to avoid colliding with Meta's wamid format.
 */
export function claimUpdate(updateId: number): boolean {
  const result = db()
    .prepare(
      `INSERT OR IGNORE INTO processed_webhook_events (external_id, source, created_at)
       VALUES (?, 'telegram', ?)`,
    )
    .run(`tg-${updateId}`, toLocalISODateTime());
  return result.changes > 0;
}

const HISTORY_LIMIT = 20;

export function loadTelegramHistory(): Anthropic.MessageParam[] {
  const rows = db()
    .prepare(
      `SELECT role, content
         FROM messages
        WHERE channel = 'telegram'
        ORDER BY id DESC
        LIMIT ?`,
    )
    .all(HISTORY_LIMIT) as Array<{ role: string; content: string }>;

  const out: Anthropic.MessageParam[] = [];
  for (const r of rows.reverse()) {
    if (r.role === "user") out.push({ role: "user", content: r.content });
    else if (r.role === "assistant") out.push({ role: "assistant", content: r.content });
  }
  return out;
}

function persist(args: {
  direction: "inbound" | "outbound";
  role: "user" | "assistant";
  content: string;
  externalId?: string | null;
  meta?: Record<string, unknown>;
}): void {
  db()
    .prepare(
      `INSERT INTO messages (created_at, channel, direction, role, content, meta_json)
       VALUES (?, 'telegram', ?, ?, ?, ?)`,
    )
    .run(
      toLocalISODateTime(),
      args.direction,
      args.role,
      args.content,
      JSON.stringify({ externalId: args.externalId ?? null, ...(args.meta ?? {}) }),
    );
}

/**
 * Process a single inbound Telegram message. Same shape as the WhatsApp
 * processor: load history → persist user msg → dispatch → persist + send
 * assistant reply. Errors here surface only in the service log; we attempt
 * a best-effort failure-notice reply to the operator.
 */
export async function processTelegramMessage(
  ext: ExtractedTelegramMessage,
): Promise<void> {
  const log = logger.child({
    update_id: ext.updateId,
    chat: ext.message.chat.id,
  });
  try {
    const priorHistory = loadTelegramHistory();
    persist({
      direction: "inbound",
      role: "user",
      content: ext.message.text,
      externalId: `tg-${ext.updateId}`,
    });

    const output = await runChiefOfStaff({
      userMessage: ext.message.text,
      priorHistory,
    });

    persist({
      direction: "outbound",
      role: "assistant",
      content: output.text,
      meta: {
        usage: output.usage,
        toolCalls: output.toolCalls.map((t) => ({ name: t.name, is_error: t.is_error ?? false })),
      },
    });

    await sendTelegram(output.text);
    log.info({ tool_calls: output.toolCalls.length }, "telegram turn completed");
  } catch (err) {
    log.error({ err }, "telegram turn failed");
    try {
      await sendTelegram("(Council) I hit an error processing that message. Check the logs.");
    } catch {
      // Already logged; don't recurse.
    }
  }
}
