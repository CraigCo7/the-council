# Architecture

## Tenets

1. **Vault is source of truth.** No separate database of record for tasks, decisions, or briefs. The vault's git history is the audit log.
2. **Backend is the primary writer.** It pulls before writing, commits per logical change, and pushes. User devices pull from GitHub.
3. **Tools do side effects. LLM does reasoning.** Chief of Staff decides *what* to do; the tool layer decides *how* to persist it. The tool layer enforces schema, naming, and the approval gate.
4. **Approval queue for anything destructive.** Deletions, bulk changes, overwrites → queued. Operator confirms.
5. **Cost discipline.** Tiered models by role; prompt caching on all system prompts.

## Component diagram

```
 ┌─────────────────────────────────────────────────────┐
 │ INPUT SURFACES                                      │
 │   CLI · HTTP · WhatsApp (phase 3)                   │
 └─────────────┬───────────────────────────────────────┘
               │
               ▼
 ┌─────────────────────────────────────────────────────┐
 │ BACKEND (Node + TS, Fastify)                        │
 │                                                     │
 │   intake/ ──▶ runChiefOfStaff()                     │
 │                   │                                 │
 │                   ├─tool: create_task ──┐           │
 │                   ├─tool: update_task ──┤           │
 │                   ├─tool: list_tasks ───┤──▶ vault/ │
 │                   ├─tool: list_overdue ─┤           │
 │                   ├─tool: propose_approval ─▶ SQLite│
 │                   └─tool: consult_strategic_analyst │
 │                            │                        │
 │                            ▼                        │
 │                     strategic-analyst.ts  (Opus)    │
 │                                                     │
 │   jobs/cron ──▶ briefs/{daily,weekly} ──▶ vault/    │
 │   messenger/ ──▶ console | WhatsApp                 │
 └─────────────┬───────────────────────────────────────┘
               │ pull → edit → commit → push
               ▼
 ┌─────────────────────────────────────────────────────┐
 │ council-vault (GitHub, private)                     │
 └─────────────────────────────────────────────────────┘
```

## Agent orchestration (v1)

- **Chief of Staff** is one Claude call (`Haiku` by default) with a tool set. It runs a manual tool-use loop (up to 8 iterations).
- **Strategic Analyst** is invoked via `consult_strategic_analyst` — a tool that makes a fresh Claude call (`Opus` with adaptive thinking) and returns the result.
- **Intelligence Monitor** is a scheduled job (not an interactive agent in v1). It reads vault state and produces a `SignalSummary`.
- **Task Operator** and **Vault Manager** are implemented as the tools layer itself — Claude's tool calls directly invoke `createTask` / `updateTask` / `commitAndPush`. No separate LLM call.

Why: premature multi-agent separation is the #1 way these projects die. One router + specialists-as-tools is simpler, faster, and cheaper. We promote a specialist to a real independent LLM only when routing complexity justifies it.

## Cost model

Tiered models (set per-role in `.env`):

| Role | Default model | Why |
|---|---|---|
| `routine` | Haiku 4.5 | Classification, task creation, quick replies. Cheap. |
| `brief` | Sonnet 4.6 | Daily brief, Intelligence Monitor. Balanced. |
| `strategic` | Opus 4.7 + adaptive thinking | Weekly review, Strategic Analyst. Correctness > cost. |

Prompt caching is applied to:
- All agent system prompts (`ephemeral` breakpoint).
- Anything that would repeat across requests.

Expected monthly LLM cost at typical personal use: **$8–20**. Hosting: **$0–5** (Fly.io free tier). Total: **$8–25**.

## Data layer

- **Vault (git)** — the authoritative store.
- **SQLite** (local file) — transient state only:
  - `approvals` — pending destructive operations.
  - `messages` — inbound/outbound message log (for context & debugging).
  - `cron_runs` — job execution history.
  - `kv` — generic key-value for small state.

If SQLite is lost, nothing important is lost — the vault survives.

## Safety rails

- **Path escape prevention.** `vaultResolve()` rejects any path that escapes the vault root.
- **Schema validation on every write.** Zod validates frontmatter before markdown is generated.
- **Approval gate for destructive edits.** `propose_approval` tool never executes; it queues.
- **Typed LLM errors.** Retries are handled by the Anthropic SDK (`max_retries` default); typed exceptions propagate up.
- **Token auth on HTTP.** All endpoints require `Authorization: Bearer ${INTAKE_TOKEN}` except `/health` and WhatsApp webhook verification.

## Deployment

v1 target: **Fly.io**.
- 1× shared-cpu-1x VM (256–512 MB)
- 3 GB persistent volume mounted at `/data` (holds `./vault` clone + SQLite)
- Secrets: `fly secrets set ANTHROPIC_API_KEY=... VAULT_REMOTE=... INTAKE_TOKEN=...`
- Scheduled jobs run in-process via `node-cron` — no external scheduler needed.

For Phase 3 (WhatsApp), the webhook URL is the Fly app's HTTPS URL: `https://council.fly.dev/webhooks/whatsapp`.
