# Integration: Telegram (the communication channel)

**Role:** the chat surface. Telegram is how the operator talks to **Alfred** —
it carries your messages in and Alfred's replies, receipts, and scheduled briefs
out. It holds no state and is not a source of truth; it's a transport. (The
[vault](./obsidian.md) is canonical; [Linear](./linear.md) is the task
projection.)

Telegram was chosen over WhatsApp because the Bot API is free, public, and has no
business-portfolio risk system to block automated traffic. The WhatsApp code is
parked (`WHATSAPP_ENABLED=false`) but intact.

```
   YOU (phone)                 Fly machine                         Telegram
  ┌──────────┐   HTTPS POST  ┌─────────────────────────┐  HTTPS  ┌──────────┐
  │  Telegram│ ────────────▶ │ POST /webhooks/telegram │         │ Bot API  │
  │   app    │   (webhook)   │  verify secret → 200    │         │          │
  │          │ ◀──────────── │  async: dispatch Alfred │ ──────▶ │ sendMsg  │
  └──────────┘   reply text  └─────────────────────────┘         └──────────┘
```

For the full task path behind a message, see
[`docs/TASK-LIFECYCLE.md`](../TASK-LIFECYCLE.md).

---

## Plain-English: what happens when you send a message

1. You text the bot. Telegram delivers it to the backend as an HTTPS webhook POST.
2. The backend checks a **shared secret** Telegram includes in a header, and that
   the message is from **your** chat. Anything else is dropped.
3. It **acknowledges instantly** (HTTP 200) so Telegram doesn't redeliver, then
   does the real work in the background.
4. It loads recent conversation history, hands your message to Alfred, Alfred
   does its thing (capturing tasks, looking things up, etc.), and the reply is
   formatted and sent back to your chat.
5. You see the reply — usually within 5–10 seconds.

You are **not charged** for Telegram — it's free. The cost is the Claude calls
behind the scenes (see [`docs/TASK-LIFECYCLE.md`](../TASK-LIFECYCLE.md)).

---

## Inbound: webhook → Alfred

> Files: [`intake/http.ts`](../../apps/backend/src/intake/http.ts),
> [`intake/telegram.ts`](../../apps/backend/src/intake/telegram.ts)

Telegram delivers each update as a single HTTPS POST to
`/webhooks/telegram`. The handler:

1. **Auth.** The global Bearer-token gate is bypassed for this route; auth lives
   inside the handler. It reads the `X-Telegram-Bot-Api-Secret-Token` header and
   `verifyTelegramSecret()`-compares it (constant-time) against
   `TELEGRAM_WEBHOOK_SECRET`. Mismatch → **403**, dropped.
2. **Ack immediately.** Returns `200` right away — anything slow gets redelivered
   by Telegram. The actual processing runs in `setImmediate(...)` so the LLM call
   never blocks the response.
3. **Extract.** `extractTelegramMessage()` Zod-narrows the update to a clean
   `{ updateId, message }`. **Only text messages** survive — edits, callbacks,
   photos, voice notes, channel posts all return `null` and are silently ignored.
4. **Filter chat.** `isExpectedChat()` allows only `TELEGRAM_CHAT_ID`; anything
   else is logged and dropped. (This is the only chat the bot will ever serve.)
5. **Dedupe.** `claimUpdate()` does an `INSERT OR IGNORE` into
   `processed_webhook_events` keyed `tg-<update_id>`. If the row already existed,
   it's a Telegram retry → skip. (Belt-and-suspenders alongside the fast 200.)
6. **Process.** `processTelegramMessage()` then:
   - loads the last 20 turns of **Telegram-only** history from the `messages`
     table (channels don't bleed into each other),
   - persists your inbound message,
   - runs `runChiefOfStaff({ userMessage, priorHistory })`,
   - persists the assistant reply (with usage + tool-call metadata),
   - sends the reply via `sendTelegram()`.

   If anything throws, it logs and attempts a best-effort
   `(Council) I hit an error processing that message. Check the logs.` reply.

---

## Outbound: reply → Telegram

> [`messenger/telegram.ts`](../../apps/backend/src/messenger/telegram.ts) — `sendTelegram`

Before any text leaves the machine it passes through, in order:

1. **Empty-text guard.** `sendTelegram` *refuses* to send empty/whitespace text
   (Telegram returns `400 message text is empty`). An empty reply means something
   upstream went wrong; the guard turns it into a noticed error instead of a
   crash. (This pairs with the receipt logic below.)
2. **`mdToTelegramHtml`** — HTML-escapes `& < >` first, then converts the small
   Markdown subset Alfred emits: `**bold**` → `<b>`, `` `code` `` → `<code>`,
   `[text](url)` → `<a href>`. (HTML mode is used over MarkdownV2 because
   MarkdownV2's escaping rules are brutal.)
3. **`humanizeDates`** — rewrites ISO calendar dates (`2026-05-07`) to
   `May 7 2026`, with regex guards so datetimes and ID-embedded dates aren't
   mangled. **This is the only place dates are humanized** — the vault and Linear
   stay ISO.
4. **Truncate** to Telegram's 4096-char cap.

Then it `POST`s to `https://api.telegram.org/bot<token>/sendMessage` with
`parse_mode: "HTML"` and `disable_web_page_preview: true`. The **bot token in the
URL** is the auth; there's no separate header.

### Receipts are code-generated, not model-written

The `✓ Captured / Updated / Dropped` lines you see are synthesized by the backend
from real tool results — Alfred is forbidden from writing them, and any it writes
are stripped. If Alfred ever *claims* a capture without actually calling the tool
(a "forged receipt"), the loop now **forces a real tool call on a retry** so the
work actually lands; only if that fails do you get a visible
`(Council) I claimed to capture…` fallback rather than silent loss. Details in
[`agents/chief-of-staff.ts`](../../apps/backend/src/agents/chief-of-staff.ts) and
[`docs/TASK-LIFECYCLE.md`](../TASK-LIFECYCLE.md).

### The channel abstraction

> [`messenger/index.ts`](../../apps/backend/src/messenger/index.ts) — `send`

Scheduled jobs (daily brief, weekly review, cost report) call the channel-agnostic
`send(text, "telegram")`, which falls through `telegram → whatsapp → console` so a
misconfigured messenger never silently swallows a brief.

---

## Auth model

Telegram does **not** sign payloads (no HMAC), so the integration uses Telegram's
`secret_token` mechanism: a high-entropy string registered when the webhook is set
(`setWebhook`), which Telegram echoes back in the
`X-Telegram-Bot-Api-Secret-Token` header on every request. The handler does a
constant-time compare.

- This is weaker than per-payload signing, so the secret must be high-entropy and
  only ever travel over HTTPS (it does — Fly terminates TLS).
- Telegram restricts the token charset to `A–Z a–z 0–9 _ -`. Generate one with
  `openssl rand -hex 32`.

| Boundary | Auth |
|---|---|
| Telegram → `/webhooks/telegram` (inbound) | `secret_token` header, constant-time compared |
| Backend → Telegram (outbound) | bot token embedded in the API URL |

---

## Failure modes

| Situation | What you'll see | Notes |
|---|---|---|
| Backend mid-redeploy | Brief 502/503 for ~10–30s | Telegram retries; the dedupe table prevents double-processing |
| Network blip Telegram→backend | Slight delay, then it arrives | Telegram retries automatically |
| Non-text message (photo, voice, edit) | No response | Intentionally ignored at extract |
| Message from another chat | No response | Dropped by the chat filter |
| Empty reply from Alfred | No message (and a logged error) | Empty-text guard prevents a 400 crash |
| Processing throws | `(Council) I hit an error…` | Best-effort failure notice; check `fly logs` |

If you sent a message and got nothing back, `fly logs --app the-council-empty-voice-9193`
is the first place to look — every step above logs.

---

## Configuration

Set as Fly secrets (never echoed/committed):

| Secret / env | Purpose |
|---|---|
| `TELEGRAM_ENABLED` | `true` to turn the channel on |
| `TELEGRAM_BOT_TOKEN` | from @BotFather, format `<botid>:<hash>` — also the outbound auth |
| `TELEGRAM_CHAT_ID` | the only chat served; get it via `getUpdates` after first messaging the bot |
| `TELEGRAM_WEBHOOK_SECRET` | the `secret_token`; `openssl rand -hex 32` |

The webhook itself is registered once with Telegram's `setWebhook` pointing at
`https://the-council-empty-voice-9193.fly.dev/webhooks/telegram` with the secret.

---

## Where to look in code

| Concern | File |
|---|---|
| Webhook route, auth bypass, ack, async dispatch | [`intake/http.ts`](../../apps/backend/src/intake/http.ts) |
| Extract / verify secret / chat filter / dedupe / process | [`intake/telegram.ts`](../../apps/backend/src/intake/telegram.ts) |
| Outbound send, Markdown→HTML, date humanizing | [`messenger/telegram.ts`](../../apps/backend/src/messenger/telegram.ts) |
| Channel selection + fallback | [`messenger/index.ts`](../../apps/backend/src/messenger/index.ts) |
| Alfred loop + receipt synthesis | [`agents/chief-of-staff.ts`](../../apps/backend/src/agents/chief-of-staff.ts) |
