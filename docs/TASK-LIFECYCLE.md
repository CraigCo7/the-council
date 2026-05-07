# Task Lifecycle — End-to-End Flow

This is a debugging reference for what actually happens when you ask Alfred to **open** (create) or **close** (mark done) a task. Same machinery handles every modification: re-prioritize, change deadline, move project, change status. They all funnel through the same path.

If something behaves wrong, find the symptom in the steps below and jump to the file/line indicated.

---

## TL;DR — the picture

```
   Telegram                    Fly.io machine                          GitHub
  ┌────────┐    HTTPS    ┌──────────────────────────────┐    git    ┌──────────┐
  │  YOU   │ ──────────▶ │   /webhooks/telegram         │           │ council- │
  │ (phone)│             │   ↓                          │           │  vault   │
  └────────┘             │   Auth: secret_token header  │           │ (private │
       ▲                 │   Filter: chat_id            │           │  repo)   │
       │ HTTPS reply     │   Dedupe: update_id          │           └──────────┘
       │                 │                              │                ▲ ▼
       │                 │   ↓                          │    git pull/push (PAT auth,
       └─────────────────│   processTelegramMessage     │     to /data/vault on the
                         │   ↓                          │     persistent volume)
                         │   load history (SQLite)      │
                         │   ↓                          │
                         │   runChiefOfStaff (Alfred)   │ ──HTTPS──▶  Anthropic API
                         │   ↓ tool_use loop            │ ◀────────  (Claude Sonnet 4.6)
                         │   ↓                          │
                         │   dispatch tool              │
                         │   ↓                          │
                         │   write markdown + commit    │ ───────▶  GitHub
                         │   ↓                          │
                         │   composeFinalText:          │
                         │     receipts (from tool      │
                         │      results, not LLM)       │
                         │     + model commentary       │
                         │   ↓                          │
                         │   sendTelegram               │ ──HTTPS──▶  Telegram Bot API
                         └──────────────────────────────┘
```

Every step has guards. The vault is the single source of truth — SQLite holds operational state only and can be wiped without losing any task data.

---

## Plain-English version (no code references)

If you just want to understand what's happening at a high level — what your money buys, when data lands, and where the system can break — start here. The technical walkthroughs below answer "where in the codebase," but those don't matter for operating the system day-to-day.

### What happens when you make a task call

Step by step, in order, from the moment you hit "send" on Telegram:

1. **Telegram receives your message** and forwards it to your Council backend (the always-on machine on Fly).
2. **The backend confirms it's actually you** — it checks the secret Telegram includes in the request and the chat ID. Anything not from you is dropped.
3. **The backend syncs the vault** — pulls the latest from GitHub in case you edited a task in Obsidian on your laptop since the last interaction. This is what keeps Alfred from clobbering your manual edits.
4. **The backend asks Claude what to do** — it sends your message + the long Alfred prompt + the recent conversation + the list of available tools. Claude reads it and decides: "this looks like a task to capture."
5. **Claude calls a tool** — it tells the backend "create a task named X in project Y with priority Z and deadline tomorrow."
6. **The backend writes the task** — it generates an ID, builds the markdown file, saves it to the local copy of the vault, then `git commit` and `git push` to GitHub. By the end of this step, your task is durably on GitHub.
7. **The backend tells Claude the result** — "Done, here's the task data."
8. **Claude wraps up** — usually with no further commentary. The receipt you see (`✓ Captured: ...`) is **not** written by Claude — the backend writes it from the actual data that was just saved. (This is why receipts are now trustworthy.)
9. **The reply goes back to Telegram** — formatted with bold labels and human-readable dates.
10. **You see the receipt on your phone** — usually within 5–10 seconds total.

For closing a task ("mark X as done") or modifying ("move X to YNG"), the same flow runs but with one extra round trip: Claude calls `list_tasks` first to look up the task by description, then calls `update_task` with the real ID. That's three Claude calls instead of two.

### Where things can go wrong

Roughly in increasing order of how often you'll see them:

| Failure | What you'll see | Where it lives |
|---|---|---|
| **Network blip on Telegram → backend** | Slight delay, then the message arrives. Telegram retries automatically. | Telegram's infrastructure |
| **Backend is in the middle of a redeploy** | Brief 502/503 from Fly's edge for 10–30 seconds. Telegram will retry; the message lands once the new machine is healthy. | Fly.io |
| **Vault sync conflict** (you edited a task in Obsidian and Alfred edits the same one before pulling) | A warning in `fly logs`. The bot's write may overwrite your manual edit, or `git push` may fail. Rare with one user; would be a bigger issue with a team. | Vault git client |
| **Claude misclassifies** (defaults to wrong project, sets a P2 you'd call P1, etc.) | The receipt shows the wrong category. You can correct it with a follow-up message ("change priority to P1"). | Alfred's prompt + Claude itself |
| **Tool execution fails** (vault disk full, GitHub temporarily unreachable, PAT revoked) | Alfred replies with an error message saying what failed. The task is NOT in the vault. You re-issue when the cause is resolved. | Tool dispatcher |
| **Claude API outage** | The bot doesn't respond at all, or returns a generic error. Anthropic's status page tells you whether it's their problem. | Anthropic |
| **Forging** (Claude says "✓ Captured" without actually creating the task) | Used to be a real risk. As of PR #14, **the system writes the receipt from real data, so this can't happen anymore**. The model could write a fake receipt line, but it gets stripped before you ever see it. | Eliminated |
| **GitHub PAT expires** | Vault writes start failing. You see "tool returned an error" on the next capture. Fix is to generate a new PAT and `fly secrets set VAULT_REMOTE=...`. | GitHub |
| **Anthropic spend cap hit** | Bot stops responding mid-sentence or returns an error. You'd raise the cap in the Anthropic console. The cap is set to $25/month right now. | Anthropic |

If something silently goes wrong (you sent a message, didn't get a reply), `fly logs --app the-council-empty-voice-9193` is the first place to look. Every step above logs something.

### When does a commit get stored to the vault?

**Once per successful write tool call**, immediately after the file is saved.

Concretely:

| Action | Commits | Notes |
|---|---|---|
| Capture a single task | 1 commit | "task: capture T-... — Title" |
| Mark a task done | 1 commit | "task: update T-..." |
| Move a task to a different project | 1 commit | "task: update T-..." |
| Edit a task by description ("mark X done") | 1 commit | The `list_tasks` lookup doesn't commit anything; only the `update_task` does |
| Ask "what's overdue" | 0 commits | Read-only |
| Ask "what's on my plate" | 0 commits | Read-only |
| Pressure-test a decision (Strategic Analyst) | 0 commits | The Analyst doesn't write to the vault |
| Daily brief at 07:00 | 1 commit | The brief markdown file in `09-Briefs/` |
| Weekly review on Sunday | 1 commit | Same idea, in `04-Weekly/` |

Each commit is pushed to GitHub immediately as part of the same operation. By the time you see the `✓ Captured` receipt on Telegram, the file is already on GitHub. Pull from your laptop and Obsidian will show the new task.

If multiple writes happen in one conversational turn (rare — say, you ask Alfred to create three tasks in one message), each one gets its own commit. You'll see three commits on GitHub.

If `git push` fails (network blip), the commit stays on the Fly machine's local copy and pushes on the next operation. The data is safe; it's just not on GitHub yet.

### When you're charged for Anthropic credits

Every time the backend calls the Claude API. Concretely:

| Operation | Number of Claude calls | Approximate cost (with cache) |
|---|---|---|
| Simple capture ("remind me to do X") | 2 Sonnet calls | ~$0.003 |
| Status check ("what's overdue") | 2 Sonnet calls | ~$0.002 |
| Edit by description ("mark X done") | 3 Sonnet calls | ~$0.005 |
| Pressure-test a decision | 2 Sonnet + 1 Opus call | ~$0.05–0.10 |
| Daily brief (cron, 07:00) | 1 Sonnet call | ~$0.005 |
| Weekly review (cron, Sunday 18:00) | 1 Opus call | ~$0.05 |
| Hourly cost rollup (cron) | 0 Claude calls | $0 — pure SQLite math |

You are NOT charged for:

- Telegram messages (free)
- GitHub operations (free, public + private repos)
- Fly.io hosting (fixed ~$2–4/month regardless of traffic)
- The webhook delivery itself, the SQLite writes, or the markdown file generation
- The receipt synthesis (it's pure code — no Claude call)

The cost is dominated by the **Anthropic input tokens** (the prompt + history + tool results sent to Claude) and **output tokens** (Claude's reply). Prompt caching makes the first ~3,000 tokens of every request very cheap on the second and subsequent turns within a 5-minute window — that's why the per-call cost stays in the fraction-of-a-cent range.

The Strategic Analyst is the most expensive thing in the system because it uses Opus 4.7 with extended thinking. Each consult is ~10–30× the cost of a simple capture. Worth it for genuine decisions; deliberately gated behind the routing rule "consult only on real tradeoffs."

A typical heavy day (50 messages, 5 brief generations, 3 strategic consults, daily + weekly briefs) runs about **\$0.50–\$1.00 in Anthropic spend**. Light days are **under \$0.20**. The \$25/month cap leaves substantial headroom.

The 23:59 cost report writes today's actual spend to `fly logs` and Telegram — that's the ground truth, not these estimates.

---

## Opening a task

**You text:** `remind me to call Wendy tomorrow`

### 1. Telegram delivers the update

Telegram sends an HTTPS POST to `https://the-council-empty-voice-9193.fly.dev/webhooks/telegram` with:

- Header `X-Telegram-Bot-Api-Secret-Token: <secret>`
- Body roughly:
  ```json
  {
    "update_id": 982734,
    "message": {
      "message_id": 1234,
      "chat": { "id": <your-chat-id>, "type": "private" },
      "text": "remind me to call Wendy tomorrow",
      "date": 1746547200,
      "from": { "id": <your-user-id> }
    }
  }
  ```

### 2. Auth gate

> **File:** `apps/backend/src/intake/http.ts` — `onRequest` hook

The Bearer-token gate that protects `/message` is **bypassed** for `/webhooks/telegram`. Auth on this route lives inside the handler.

### 3. Webhook handler verifies secret + acks immediately

> **File:** `apps/backend/src/intake/http.ts` — `app.post("/webhooks/telegram", ...)`

- Reads the `X-Telegram-Bot-Api-Secret-Token` header.
- Calls `verifyTelegramSecret(provided, expected)` (constant-time string compare in `src/intake/telegram.ts`). Mismatch → 403, request dropped.
- Returns **HTTP 200 immediately** so Telegram doesn't redeliver.
- Spawns the actual processing via `setImmediate` so the response isn't blocked by an LLM call.

### 4. Async processing — extract, filter, dedupe

> **File:** `apps/backend/src/intake/telegram.ts`

- `extractTelegramMessage(payload)` — Zod-narrows the nested Telegram update to a clean `{ updateId, message: { chat, text, ... } }` shape. Returns `null` for edits, callbacks, photos, voice notes, channel posts, etc. (silently ignored).
- `isExpectedChat(chat.id)` — only `TELEGRAM_CHAT_ID` is allowed; anything else is logged and dropped.
- `claimUpdate(updateId)` — `INSERT OR IGNORE` into the `processed_webhook_events` table with PK `tg-<update_id>`. If the row already existed, this is a Telegram retry; skip.
- If all three pass, calls `processTelegramMessage(ext)`.

### 5. Process the message — load history, dispatch, persist

> **File:** `apps/backend/src/intake/telegram.ts` — `processTelegramMessage`

```
loadTelegramHistory()                     // last 20 turns from messages table
  ↓
persist(direction='inbound', role='user', ...)
  ↓
runChiefOfStaff({ userMessage, priorHistory })
  ↓
persist(direction='outbound', role='assistant', ...)
  ↓
sendTelegram(output.text)
```

History is per-channel — Telegram and (parked) WhatsApp don't bleed into each other.

### 6. Alfred's tool-use loop

> **File:** `apps/backend/src/agents/chief-of-staff.ts` — `runChiefOfStaff`
> **Prompt:** `apps/backend/src/agents/prompts/chief-of-staff.md`

- Loads the prompt with template substitutions (`{{operator_name}}`, `{{today_iso}}`, `{{projects}}`, etc.) — see `prompt-loader.ts`.
- Calls `anthropic.messages.create` with the cached system prompt, tool definitions, and message history including the new user message.
- Default model: `claude-sonnet-4-6`. Cache hit on the system prompt (~3000 tokens) keeps per-turn cost low.

The model decides this is actionable and emits a `tool_use` block:

```json
{
  "name": "create_task",
  "input": {
    "title": "Call Wendy",
    "type": "reminder",
    "project": "BidaWash",
    "priority": "P2",
    "deadline": "2026-05-07"
  }
}
```

(Project, priority, and deadline are Alfred's classifications based on the routing/heuristics rules in the prompt.)

### 7. Tool dispatch — the durable write

> **File:** `apps/backend/src/tools/dispatch.ts` — `create_task` case
> **Vault layer:** `apps/backend/src/vault/{tasks.ts, client.ts, fs.ts}`

In order:

1. **Zod validate** the input via `CreateTaskInput` (`src/vault/tasks.ts`).
2. **`syncPull()`** — `git pull --rebase origin main` on `/data/vault`. Pulls in any vault edits made via Obsidian on your laptop since the last sync. Failures here are non-fatal (logged warning, proceed with local state).
3. **`createTask(parsed)`** — generates the ID (`T-YYYYMMDD-slug-of-title`), builds the frontmatter object, writes `/data/vault/02-Tasks/2026/T-20260506-call-wendy.md`.
4. **`commitAndPush()`** — `git add <relPath>`, `git commit -m "task: capture T-... — Call Wendy"`, `git push origin main`. The PAT in `VAULT_REMOTE` authenticates the push.
5. Return value:
   ```json
   {
     "ok": true,
     "id": "T-20260506-call-wendy",
     "relPath": "02-Tasks/2026/T-20260506-call-wendy.md",
     "committed": true,
     "hash": "abc123...",
     "task": { /* full frontmatter snapshot */ }
   }
   ```

The `task` field is the post-write state of the frontmatter. **This is the source for the receipt** (see step 9).

### 8. Tool result returned to the model

> **File:** `apps/backend/src/agents/chief-of-staff.ts` (loop body)

The dispatcher's JSON return is wrapped in a `tool_result` block and appended to the conversation. The next iteration of the loop calls Anthropic again with the updated history. The model now knows the task was persisted; it produces final commentary (often nothing) and the loop terminates with `stop_reason: "end_turn"`.

### 9. composeFinalText — receipts are synthesized, not trusted

> **File:** `apps/backend/src/agents/chief-of-staff.ts` — `composeFinalText`, `receiptFor`, `stripModelReceipts`

This is the structural anti-forging fix from PR #14. The model **does not** write `✓ Captured:` lines anymore. The system writes them, from real tool result data:

1. For each tool call where `name in {create_task, update_task}` AND `is_error == false` AND the result JSON has a `task` field:
   - Build `✓ Captured: <title> [<project> · <priority> · <deadline-or-"no deadline">]` (or `✓ Updated: ...`).
2. `stripModelReceipts(modelText)` — unconditionally removes any line starting with `✓ Captured:` or `✓ Updated:` from the model's prose. If the model wrote one anyway (forgery attempt or duplicate), it's dropped, with a warning logged.
3. Final text = `[receipts joined by newline]\n\n[stripped commentary]`.

If the model wrote nothing useful and there are no commentary lines after stripping, just the receipts ship.

### 10. Send to Telegram

> **File:** `apps/backend/src/messenger/telegram.ts` — `sendTelegram`

The text passes through two transforms in order before being sent:

1. **`mdToTelegramHtml`** — escapes `& < >` first, then converts `**bold**` → `<b>bold</b>` and `` `code` `` → `<code>code</code>`. Ensures no malformed HTML even if the agent emits unusual chars.
2. **`humanizeDates`** — finds ISO calendar dates (`YYYY-MM-DD`, with regex guards against datetimes and ID prefixes) and rewrites them to `Month Day Year`.

Result is sent via `POST https://api.telegram.org/bot<token>/sendMessage` with `parse_mode: "HTML"`. The bot token in the URL is the auth.

You see in Telegram:

> ✓ Captured: Call Wendy [BidaWash · P2 · May 7 2026]

---

## Closing a task (or any modification)

**You text:** `mark calling wendy as done`

Steps 1–5 (intake, dedupe, history load) are **identical** to opening. The divergence starts at step 6.

### 6'. Alfred resolves the reference, THEN updates

> **Routing rule #7** in `chief-of-staff.md`: when the operator references a task by description rather than ID, look it up first.

The model now emits **two** tool_use blocks across the loop:

**First iteration — `list_tasks`:**

```json
{
  "name": "list_tasks",
  "input": { "status": ["open", "in_progress", "blocked"] }
}
```

The dispatcher returns an array of `{ id, title, project, priority, status, deadline, type }`. Alfred reads it, finds the row whose title matches "calling wendy".

**Second iteration — `update_task`:**

```json
{
  "name": "update_task",
  "input": {
    "id": "T-20260506-call-wendy",
    "status": "done"
  }
}
```

The dispatcher's `update_task` case (in `src/tools/dispatch.ts`):

1. Zod validates — same shape that supports project moves, type reclassifications, etc.
2. `syncPull()` — same as create flow.
3. `updateTask(id, patch)` (`src/vault/tasks.ts`):
   - `readTask(id)` reads the existing markdown file.
   - Merges `patch` over `existing.frontmatter`.
   - `TaskFrontmatter.parse(...)` re-validates the merged shape (catches a bad patch silently; you'd see a parse error in logs).
   - Writes the file back at the same `relPath`.
   - Optionally appends a `## Log` line if `logEntry` was passed.
4. `commitAndPush()` — `task: update T-...`.
5. Returns `{ ok: true, id, committed, hash, task: <updated frontmatter> }`.

### 7'-10'. Same as opening

`composeFinalText` synthesizes:

> ✓ Updated: Call Wendy [BidaWash · P2 · May 7 2026]

(Status `done` is in the frontmatter, but the receipt format doesn't currently surface it — the receipt confirms the update happened; checking detailed state goes through `list_tasks`.)

---

## What's preserved across the flow

### Source of truth

The vault is canonical. Everything in SQLite (`messages`, `processed_webhook_events`, `cron_runs`, etc.) is operational state — disposable. If `/data` on the Fly volume were destroyed:
- The Fly machine would crash-loop until restored.
- Re-clone the vault from GitHub → all task data is back.
- SQLite gets recreated empty on next boot from `schema.sql`.
- Conversation history is gone. Idempotency is reset (so a single retried Telegram update could double-fire — minor).

### Security boundaries crossed in one capture

| Boundary | Auth |
|---|---|
| Telegram → webhook | `secret_token` header constant-time-compared in handler |
| HTTP `/message` (alt path) | Bearer `INTAKE_TOKEN` |
| Backend → vault repo (clone/push) | GitHub PAT embedded in `VAULT_REMOTE` |
| Backend → Anthropic | `ANTHROPIC_API_KEY` |
| Backend → Telegram (outbound) | bot token in URL |

Each boundary has its own credential, set as a Fly secret. Rotating any one doesn't disturb the others.

### Idempotency

- Every Telegram update has an `update_id`; we record it in `processed_webhook_events.external_id` as `tg-<id>` with `INSERT OR IGNORE`.
- Telegram redelivers if it doesn't get a 200 within a few seconds. We always 200 immediately, but the dedupe is belt-and-suspenders for the rare case where the response is lost in transit.
- Same table is shared with WhatsApp (parked), prefixed `wamid-...` to avoid collisions.

### Observability

- `pino` structured logs at every important step (config, db, vault, intake, agent, messenger, cron).
- Per-LLM-call usage logged with `label`, `input`, `output`, `cache_read`, `cache_create`.
- Hourly cost rollup written to `kv` table by the cost estimator.
- Daily cost report at 23:59 Manila → both `fly logs` and Telegram.

---

## Failure modes worth knowing

### Vault git push fails

`commitAndPush` catches the push error, leaves the commit local, and returns `committed: true, hash: ...`. The next operation that calls `commitAndPush` will try to push again (and any unpushed commits go with it). If the failure persists (broken PAT, stale credentials), the `/data/vault/.git` directory accumulates unpushed commits — visible via `fly ssh console` + `git log origin/main..HEAD`.

### Vault pull conflict

`syncPull` does `git pull --rebase`. If you edited the same task concurrently in Obsidian on your laptop, rebase may conflict. Currently this surfaces as a `pull failed — continuing with local state` warning; the write proceeds, push may fail with non-fast-forward. Resolution: SSH into the machine, manual `git pull --rebase` / merge, `git push`. **Mitigation:** for v1, don't simultaneously edit the same task in Obsidian and via Alfred.

### Tool error

If `dispatchTool` throws, the outer try/catch in `dispatch.ts` returns `{ content: '{"ok":false,"error":...}', is_error: true }`. The model sees `is_error: true`, reports the failure to the operator. **No receipt is synthesized** for errored tool calls — `receiptFor` returns `null` if `call.is_error` is true.

### Forging (eliminated)

Pre-PR #14: model could write `✓ Captured: ...` text without calling `create_task`. The Christian and Randy losses were this. Post-PR #14: receipts come from tool result data only. The model has no affordance to forge.

### Forge attempt (silently handled)

If the model writes a `✓ Captured:` line anyway (drift, hallucination), `stripModelReceipts` removes it before send. A warning logs to `fly logs`. The user sees only the system-synthesized receipt (or nothing, if no real tool ran).

### Cache miss

The Alfred system prompt is ~3000 tokens, comfortably above Sonnet's 2048-token cache minimum. The cache invalidates at midnight Manila (today's date is in the prompt). On the first turn after midnight, you pay full input cost; subsequent turns within a 5-minute cache window read at ~10% cost. If cache_read is consistently 0 outside of that window, something is regenerating the system prompt non-deterministically — check `prompt-loader.ts`.

---

## Where to look in the code

| Concern | File |
|---|---|
| Telegram webhook routing | `apps/backend/src/intake/http.ts` |
| Telegram payload parser, dispatch, history | `apps/backend/src/intake/telegram.ts` |
| Alfred tool-use loop, receipt synthesis | `apps/backend/src/agents/chief-of-staff.ts` |
| Alfred prompt | `apps/backend/src/agents/prompts/chief-of-staff.md` |
| Tool input schemas (what Claude sees) | `apps/backend/src/tools/definitions.ts` |
| Tool implementations (what runs) | `apps/backend/src/tools/dispatch.ts` |
| Vault git operations | `apps/backend/src/vault/client.ts` |
| Task CRUD on markdown | `apps/backend/src/vault/tasks.ts` |
| Frontmatter / Zod schemas | `apps/backend/src/vault/schemas.ts` |
| Outbound to Telegram | `apps/backend/src/messenger/telegram.ts` |
| Markdown → Telegram HTML | `apps/backend/src/messenger/telegram.ts` (`mdToTelegramHtml`, `humanizeDates`) |
| SQLite (operational state) | `apps/backend/src/db/sqlite.ts` + `apps/backend/src/db/schema.sql` |
| Cron (daily brief, weekly review, cost report) | `apps/backend/src/jobs/cron.ts` |
