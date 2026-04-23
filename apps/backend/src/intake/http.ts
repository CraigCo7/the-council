import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { runChiefOfStaff } from "../agents/chief-of-staff.js";
import { generateDailyBrief } from "../briefs/daily.js";
import { generateWeeklyReview } from "../briefs/weekly.js";
import { listPending, resolve } from "../approvals/queue.js";
import { config } from "../config.js";
import { db } from "../db/sqlite.js";
import { toLocalISODateTime } from "../vault/time.js";

const MessageInput = z.object({
  text: z.string().min(1).max(8000),
  from: z.string().optional(),
  channel: z.enum(["http", "cli", "whatsapp"]).default("http"),
});

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req, reply) => {
    // Auth gate for everything except health + WhatsApp verification.
    if (req.url === "/health") return;
    if (req.url.startsWith("/webhooks/whatsapp") && req.method === "GET") return;

    const auth = req.headers.authorization ?? "";
    const expected = `Bearer ${config.server.intakeToken}`;
    if (auth !== expected) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/health", async () => ({ ok: true, time: toLocalISODateTime() }));

  app.post("/message", async (req, reply) => {
    const parsed = MessageInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", issues: parsed.error.issues });
    }
    const { text, channel, from } = parsed.data;

    db()
      .prepare(
        `INSERT INTO messages (created_at, channel, direction, role, content, meta_json)
         VALUES (?, ?, 'inbound', 'user', ?, ?)`,
      )
      .run(toLocalISODateTime(), channel, text, JSON.stringify({ from: from ?? null }));

    const output = await runChiefOfStaff({ userMessage: text });

    db()
      .prepare(
        `INSERT INTO messages (created_at, channel, direction, role, content, meta_json)
         VALUES (?, ?, 'outbound', 'assistant', ?, ?)`,
      )
      .run(
        toLocalISODateTime(),
        channel,
        output.text,
        JSON.stringify({ usage: output.usage, toolCalls: output.toolCalls }),
      );

    return reply.send({
      text: output.text,
      toolCalls: output.toolCalls.map((t) => ({ name: t.name, is_error: t.is_error ?? false })),
      usage: output.usage,
    });
  });

  app.get("/approvals", async () => ({ pending: listPending() }));

  app.post("/approvals/:id/resolve", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const body = z.object({ decision: z.enum(["approve", "reject"]) }).parse(req.body);
    resolve(params.id, body.decision === "approve" ? "approved" : "rejected");
    return reply.send({ ok: true, id: params.id });
  });

  app.post("/briefs/daily", async () => {
    const brief = await generateDailyBrief();
    return { ok: true, relPath: brief.relPath };
  });

  app.post("/briefs/weekly", async () => {
    const review = await generateWeeklyReview();
    return { ok: true, relPath: review.relPath };
  });

  // WhatsApp webhook placeholders (Phase 3).
  app.get("/webhooks/whatsapp", async (req, reply) => {
    const q = z
      .object({
        "hub.mode": z.string().optional(),
        "hub.verify_token": z.string().optional(),
        "hub.challenge": z.string().optional(),
      })
      .parse(req.query);
    if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === config.whatsapp.verifyToken) {
      return reply.send(q["hub.challenge"]);
    }
    return reply.code(403).send();
  });

  app.post("/webhooks/whatsapp", async (req, reply) => {
    // Phase 3: parse Meta's webhook payload, extract text, dispatch through runChiefOfStaff,
    // then reply via messenger.send(..., 'whatsapp').
    req.log.info({ body: req.body }, "whatsapp webhook received (not wired)");
    return reply.send({ ok: true });
  });
}
