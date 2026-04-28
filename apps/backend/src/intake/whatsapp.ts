import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config.js";
import { db } from "../db/sqlite.js";
import { logger } from "../logger.js";
import { runChiefOfStaff } from "../agents/chief-of-staff.js";
import { sendWhatsapp } from "../messenger/whatsapp.js";
import { toLocalISODateTime } from "../vault/time.js";

/**
 * Meta's webhook payload, narrowed to just the fields we care about.
 * Anything outside this shape (status updates, non-text messages, etc.)
 * gets ignored without erroring.
 */
const MetaTextMessage = z.object({
  from: z.string(),                         // sender wa_id (digits only, no +)
  id: z.string(),                           // wamid.* — Meta's message ID
  timestamp: z.string(),
  type: z.literal("text"),
  text: z.object({ body: z.string() }),
});
type MetaTextMessage = z.infer<typeof MetaTextMessage>;

const MetaWebhookPayload = z.object({
  object: z.string().optional(),
  entry: z
    .array(
      z.object({
        changes: z.array(
          z.object({
            field: z.string().optional(),
            value: z
              .object({
                messages: z.array(z.unknown()).optional(),
              })
              .passthrough(),
          }),
        ),
      }),
    )
    .default([]),
});

/**
 * Walk Meta's nested structure and return the text messages we should act on.
 * Tolerates missing/unexpected fields — payloads carrying only delivery
 * statuses (no `messages` array) just produce an empty result.
 */
export function extractInboundMessages(payload: unknown): MetaTextMessage[] {
  const parsed = MetaWebhookPayload.safeParse(payload);
  if (!parsed.success) return [];

  const out: MetaTextMessage[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const messages = (change.value.messages ?? []) as unknown[];
      for (const m of messages) {
        const msg = MetaTextMessage.safeParse(m);
        if (msg.success) out.push(msg.data);
      }
    }
  }
  return out;
}

/**
 * Strip everything but digits — Meta's `from` arrives as `639171234567`,
 * the operator's configured number is `+639171234567`. Compare digit strings.
 */
function normalizePhone(s: string): string {
  return s.replace(/[^0-9]/g, "");
}

export function isExpectedSender(fromPhone: string): boolean {
  const expected = normalizePhone(config.whatsapp.toNumber);
  const actual = normalizePhone(fromPhone);
  return expected.length > 0 && expected === actual;
}

/**
 * Mark a Meta message ID as processed. Returns true if this is the first time
 * we're seeing it (i.e. we should process); false if it's a duplicate Meta
 * retry. Backed by `processed_webhook_events.external_id` (PRIMARY KEY).
 */
export function claimMessage(externalId: string): boolean {
  const result = db()
    .prepare(
      `INSERT OR IGNORE INTO processed_webhook_events (external_id, source, created_at)
       VALUES (?, 'whatsapp', ?)`,
    )
    .run(externalId, toLocalISODateTime());
  return result.changes > 0;
}

const HISTORY_LIMIT = 20;

/**
 * Load the most recent WhatsApp conversation turns from SQLite, formatted
 * for the Anthropic API. The `messages` table records each turn with its
 * direction ('inbound'/'outbound') and role ('user'/'assistant'); we
 * remap to MessageParam[] in chronological order.
 *
 * Only text content is preserved — tool_use / tool_result blocks are not
 * persisted (they're fully resolved within a single Chief of Staff loop).
 */
export function loadWhatsappHistory(): Anthropic.MessageParam[] {
  const rows = db()
    .prepare(
      `SELECT role, content
         FROM messages
        WHERE channel = 'whatsapp'
        ORDER BY id DESC
        LIMIT ?`,
    )
    .all(HISTORY_LIMIT) as Array<{ role: string; content: string }>;

  // Reverse to chronological order (oldest first).
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
       VALUES (?, 'whatsapp', ?, ?, ?, ?)`,
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
 * Process a single inbound text message: persist it, dispatch through
 * Chief of Staff, send the reply via Meta, and persist the reply.
 *
 * Designed to run AFTER the webhook has already returned 200 to Meta —
 * Meta retries on slow responses, so we acknowledge first and process
 * out-of-band. Errors here surface in the service log only; the operator
 * will see the lack of a reply on WhatsApp.
 */
export async function processInboundMessage(msg: MetaTextMessage): Promise<void> {
  const log = logger.child({ wamid: msg.id, from: msg.from.slice(-4) });
  try {
    // Load history BEFORE persisting the current message — otherwise we'd
    // have to slice off the just-inserted row.
    const priorHistory = loadWhatsappHistory();

    persist({
      direction: "inbound",
      role: "user",
      content: msg.text.body,
      externalId: msg.id,
    });

    const output = await runChiefOfStaff({
      userMessage: msg.text.body,
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

    await sendWhatsapp(output.text);
    log.info({ tool_calls: output.toolCalls.length }, "whatsapp turn completed");
  } catch (err) {
    log.error({ err }, "whatsapp turn failed");
    // Best-effort: tell the operator the system is broken rather than
    // leaving them wondering why the bot is silent.
    try {
      await sendWhatsapp(
        "(Council) I hit an error processing that message. Check the logs.",
      );
    } catch {
      // Already logging the original error above; don't recurse.
    }
  }
}
