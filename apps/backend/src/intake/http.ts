import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { runChiefOfStaff } from "../agents/chief-of-staff.js";
import { generateDailyBrief } from "../briefs/daily.js";
import { generateWeeklyReview } from "../briefs/weekly.js";
import { listPending, resolve } from "../approvals/queue.js";
import { config } from "../config.js";
import { db } from "../db/sqlite.js";
import { toLocalISODate, toLocalISODateTime } from "../vault/time.js";
import { verifyWhatsappSignature } from "../security/whatsapp-hmac.js";
import {
  claimMessage,
  extractInboundMessages,
  isExpectedSender,
  processInboundMessage,
} from "./whatsapp.js";
import { send } from "../messenger/index.js";
import { fitForWhatsappBody } from "../messenger/format.js";
import { logger } from "../logger.js";

// Make the raw request body available on `req.rawBody`. Required for HMAC
// verification on the WhatsApp webhook — if we re-serialize the parsed JSON,
// even one whitespace difference invalidates Meta's signature.
declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

const MessageInput = z.object({
  text: z.string().min(1).max(8000),
  from: z.string().optional(),
  channel: z.enum(["http", "cli", "whatsapp"]).default("http"),
});

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Replace the default JSON parser with one that retains the raw bytes.
  // The WhatsApp webhook needs them to verify Meta's HMAC signature.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body, done) => {
      const buf = body as Buffer;
      try {
        const json = buf.length > 0 ? JSON.parse(buf.toString("utf8")) : {};
        req.rawBody = buf;
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.addHook("onRequest", async (req, reply) => {
    // Auth gate for everything except health + WhatsApp webhooks.
    // - /health: no auth needed (used by Fly's healthcheck).
    // - /webhooks/whatsapp GET: Meta verification (auth is the verify_token).
    // - /webhooks/whatsapp POST: Meta delivery (auth is the HMAC signature
    //   verified inside the handler).
    if (req.url === "/health") return;
    if (req.url.startsWith("/webhooks/whatsapp")) return;

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
    const message = fitForWhatsappBody({
      header: `Daily brief — ${toLocalISODate()}`,
      body: brief.body,
      vaultRel: brief.relPath,
    });
    await send(message, "whatsapp");
    return { ok: true, relPath: brief.relPath };
  });

  app.post("/briefs/weekly", async () => {
    const review = await generateWeeklyReview();
    const message = fitForWhatsappBody({
      header: "Weekly review",
      body: review.body,
      vaultRel: review.relPath,
    });
    await send(message, "whatsapp");
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
    // 1. Verify Meta's HMAC signature against the raw body.
    //    Without this, the endpoint is wide open to any POST request.
    const sig = req.headers["x-hub-signature-256"];
    const sigHeader = Array.isArray(sig) ? sig[0] : sig;
    const rawBody = req.rawBody ?? Buffer.alloc(0);
    if (!verifyWhatsappSignature(rawBody, sigHeader, config.whatsapp.appSecret)) {
      logger.warn(
        { hasSig: Boolean(sigHeader), bodyLen: rawBody.length },
        "whatsapp webhook signature invalid — rejecting",
      );
      return reply.code(403).send();
    }

    // 2. Acknowledge to Meta IMMEDIATELY. Anything slower than ~5s
    //    triggers a redelivery, which would re-process the same message
    //    (idempotency below catches it, but a fast 200 avoids the round-trip).
    reply.code(200).send({ ok: true });

    // 3. Process out-of-band. Errors here do not affect the response.
    setImmediate(async () => {
      try {
        const messages = extractInboundMessages(req.body);
        for (const msg of messages) {
          if (!isExpectedSender(msg.from)) {
            logger.warn(
              { wamid: msg.id, fromTail: msg.from.slice(-4) },
              "whatsapp message from unexpected sender — dropping",
            );
            continue;
          }
          if (!claimMessage(msg.id)) {
            logger.info({ wamid: msg.id }, "whatsapp message already processed — skipping");
            continue;
          }
          await processInboundMessage(msg);
        }
      } catch (err) {
        logger.error({ err }, "whatsapp webhook background processing failed");
      }
    });
  });
}
