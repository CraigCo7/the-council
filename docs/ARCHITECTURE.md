# Architecture

## Tenets

1. **Vault is source of truth.** No separate database of record for tasks, decisions, or briefs. The vault's git history is the audit log.
2. **Backend is the primary writer.** It pulls before writing, commits per logical change, and pushes. User devices pull from GitHub.
3. **Tools do side effects. LLM does reasoning.** Chief of Staff decides *what* to do; the tool layer decides *how* to persist it. The tool layer enforces schema, naming, and the approval gate.
4. **Confirmation scales with blast radius.** Single-task deletes execute immediately (the `✓ Dropped` receipt is the confirmation). Bulk changes, multi-task deletes, and file overwrites route through an approval queue. (The queue is built but currently unused — single deletes cover every destructive op in use today.)
5. **Cost discipline.** Tiered models by role; prompt caching on all system prompts.

> **Integrations:** the three connected tools each have a dedicated runtime walkthrough in [`docs/integrations/`](integrations/) — [Obsidian/vault](integrations/obsidian.md) (canonical store), [Linear](integrations/linear.md) (actionable projection), [Telegram](integrations/telegram.md) (chat channel). This file is the system-level overview.

## Component diagram

```
        Telegram (primary) · HTTP /message · CLI         [WhatsApp parked]
                              │
                              ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ BACKEND (Node + TS, Fastify)  —  Fly.io, region sin            │
 │                                                                │
 │   intake/ ──▶ runChiefOfStaff()    (Alfred · Sonnet 4.6)       │
 │                   │   manual tool-use loop                     │
 │                   ├─ create_task / update_task / delete_task   │
 │                   ├─ list_tasks / list_overdue                 │
 │                   ├─ propose_approval          (─▶ SQLite)      │
 │                   └─ consult_strategic_analyst (─▶ Opus 4.7)    │
 │                          │                                     │
 │                          ▼                                     │
 │                   tools/dispatch ──┬──▶ vault/  (git)          │
 │                                    └──▶ linear/ (GraphQL)      │
 │                                                                │
 │   jobs/cron ──▶ briefs/{daily,weekly} ──▶ vault/ + Telegram    │
 │   messenger/ ──▶ Telegram | console        [WhatsApp parked]   │
 └───────────────┬──────────────────────────────┬─────────────────┘
   git pull/push │                               │ GraphQL
                 ▼                               ▼
   council-vault (GitHub, private)        Linear  (team CNCL + Projects)
```

The vault write is canonical and always happens; the Linear mirror is best-effort on top (see [integrations/linear.md](integrations/linear.md)).

## Agent orchestration (v1)

- **Chief of Staff** is one Claude call (`Sonnet 4.6` by default — see cost model for why not Haiku) with a tool set. It runs a manual tool-use loop (up to 8 iterations). If the model forges a `✓ Captured/Updated/Dropped` receipt without calling the backing tool, the loop forces a real tool call on a retry so the work actually lands.
- **Strategic Analyst** is invoked via `consult_strategic_analyst` — a tool that makes a fresh Claude call (`Opus` with adaptive thinking) and returns the result.
- **Intelligence Monitor** is a scheduled job (not an interactive agent in v1). It reads vault state and produces a `SignalSummary`.
- **Task Operator** and **Vault Manager** are implemented as the tools layer itself — Claude's tool calls directly invoke `createTask` / `updateTask` / `commitAndPush`. No separate LLM call.

Why: premature multi-agent separation is the #1 way these projects die. One router + specialists-as-tools is simpler, faster, and cheaper. We promote a specialist to a real independent LLM only when routing complexity justifies it.

## Cost model

Tiered models (set per-role in `.env`):

| Role | Default model | Why |
|---|---|---|
| `routine` | Sonnet 4.6 | Chief of Staff router: tool-use routing, classification, quick replies. Sonnet over Haiku because prompt caching activates at ≥2048 prompt tokens (Haiku needs ≥4096); Alfred's ~3500-token prompt caches on Sonnet, so cache reads (~10% cost) make it *cheaper* than uncached Haiku. |
| `brief` | Sonnet 4.6 | Daily brief, Intelligence Monitor. Balanced. |
| `strategic` | Opus 4.7 + adaptive thinking | Weekly review, Strategic Analyst. Correctness > cost. |

Prompt caching is applied to:
- All agent system prompts (`ephemeral` breakpoint).
- Anything that would repeat across requests.

Expected monthly LLM cost at typical personal use: **$8–20**. Hosting: **$0–5** (Fly.io free tier). Total: **$8–25**.

## Data layer

- **Vault (git)** — the authoritative store. See [integrations/obsidian.md](integrations/obsidian.md).
- **Linear** (external) — a projection of the *actionable* subset of the vault, not a store of record. Best-effort mirror; failures never block a vault write. See [integrations/linear.md](integrations/linear.md).
- **SQLite** (local file) — transient state only:
  - `approvals` — queued bulk/destructive operations (currently unused).
  - `messages` — inbound/outbound message log, per channel (context & debugging).
  - `cron_runs` — job execution history.
  - `kv` — generic key-value for small state (e.g. hourly cost rollup).
  - `processed_webhook_events` — inbound-webhook idempotency (Telegram `tg-<id>`, WhatsApp `wamid-…`).
  - `usage_records` — per-LLM-call token usage; the daily cost cron aggregates it to a $-figure.

If SQLite is lost, nothing important is lost — the vault (and Linear) survive. You lose conversation history and idempotency state only.

## Safety rails

- **Path escape prevention.** `vaultResolve()` rejects any path that escapes the vault root.
- **Schema validation on every write.** Zod validates frontmatter before markdown is generated.
- **Approval gate for *bulk* destructive edits.** `propose_approval` queues; it never executes. Single-task deletes go through `delete_task` directly (immediate, no gate).
- **Typed LLM errors.** Retries are handled by the Anthropic SDK (`max_retries` default); typed exceptions propagate up.
- **Token auth on HTTP.** All endpoints require `Authorization: Bearer ${INTAKE_TOKEN}` except `/health`, the Telegram webhook (verified by a `secret_token` header instead), and WhatsApp webhook verification (parked).

## Deployment

Deployed on **Fly.io** (app `the-council-empty-voice-9193`, region `sin`).
- 1× always-on `shared-cpu-1x` / 512 MB VM (`min_machines_running = 1`, `auto_stop_machines = off` — cron fires in-process, so the machine must stay up).
- 3 GB persistent volume mounted at `/data` (holds the `/data/vault` git clone + `/data/council.sqlite`).
- Secrets (set via `fly secrets set`, never in `fly.toml`): `ANTHROPIC_API_KEY`, `VAULT_REMOTE` (PAT-embedded GitHub URL), `INTAKE_TOKEN`, `LINEAR_API_KEY` (+ `LINEAR_TEAM_KEY`, `LINEAR_WORKSPACE_SLUG`), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`.
- Scheduled jobs run in-process via `node-cron` — no external scheduler needed.

The Telegram webhook points at the Fly app's HTTPS URL: `https://the-council-empty-voice-9193.fly.dev/webhooks/telegram`. See [`docs/DEPLOY.md`](DEPLOY.md) for the full setup sequence.
