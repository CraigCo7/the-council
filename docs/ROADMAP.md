# Roadmap

> **Status (2026-05):** Phases 0–2 shipped — the system is **live in production** on Fly.io and in daily use. Two course-changes since this roadmap was first written: (1) the messaging channel pivoted from WhatsApp to **Telegram** after Meta blocked the Cloud API (WhatsApp code is parked, not deleted); (2) a **Linear** integration (read + write) was added — it wasn't in the original plan. The phases below are annotated to reflect that. Per-tool runtime docs live in [`docs/integrations/`](integrations/).

## Phase 0 — Scaffold ✅ (this commit)

- Repo, vault template, schemas, templates
- All five agent prompt files
- Fastify + SQLite + CLI REPL
- Vault git client + safe I/O + Zod validation
- Chief of Staff with manual tool-use loop
- Strategic Analyst + Intelligence Monitor
- Approval queue, daily brief + weekly review generators
- Cron scheduling in operator timezone
- WhatsApp stub with correct interface

## Phase 1 — Local working v1 ✅

Goal: end-to-end CLI conversation commits real markdown to your vault.

- [ ] `gh auth login` (if not done) + `pnpm bootstrap-vault`
- [ ] Set `ANTHROPIC_API_KEY` + monthly cap in Anthropic console
- [ ] Run `pnpm cli` and talk to Chief of Staff for a week. Capture real tasks.
- [ ] Verify cache hits in the logs (look for `cache_read > 0` after 2nd message).
- [ ] Run `pnpm brief:daily` and `pnpm brief:weekly` manually; read the output in Obsidian.
- [ ] First weekly review — let it challenge you. Adjust prompts if tone is off.

Known things to iterate on in this phase:
- Prompt tuning for Chief of Staff tone (you will want it sharper or softer after using it).
- Task deduplication — the current `create_task` doesn't check for near-duplicates.
- A `complete_task` tool shortcut (currently `update_task` with `status=done`).

## Phase 2 — Deployed & scheduled ✅

- [ ] Create Fly.io account + app: `fly launch`
- [ ] Attach persistent volume (3 GB) mounted at `/data`
- [ ] Point `DB_PATH=/data/council.sqlite`, `VAULT_PATH=/data/vault`
- [ ] Set secrets: `fly secrets set ANTHROPIC_API_KEY=... VAULT_REMOTE=... INTAKE_TOKEN=...`
- [ ] SSH key on the Fly machine or HTTPS clone with a deploy token
- [ ] Verify cron fires: check `/health`, tail logs at 07:00 local time
- [ ] Set up Anthropic budget alert ($25/month hard cap recommended)

## Phase 3 — Messaging channel ✅ (Telegram, not WhatsApp)

Originally planned as WhatsApp two-way. Meta's risk system **blocked the new business portfolio's Cloud API access** after a few days of automated daily-brief traffic (`"API access blocked." code 200 OAuthException`). Rather than fight an opaque appeals process, the channel pivoted to **Telegram's Bot API** — free, public, no business-portfolio risk system.

What shipped instead:
- Telegram two-way chat: inbound webhook (`/webhooks/telegram`, `secret_token` auth, chat-id filter, `update_id` dedupe) → Alfred → reply.
- Outbound briefs/receipts via `messenger.send(..., 'telegram')`, with Markdown→HTML rendering and ISO-date humanizing.
- WhatsApp code is **parked, not deleted** (`WHATSAPP_ENABLED=false`) — see the "unused but intentional" note in the handoff. Re-attempting WhatsApp would require moving to the BidaWash portfolio (which has account standing) and is not currently worth it over Telegram.

Runtime detail: [`docs/integrations/telegram.md`](integrations/telegram.md).

## Linear integration (added — not in the original plan)

A task tracker projection of the actionable subset of the vault, for eventual team sharing. One team (`CNCL`) + five Projects; employees as labels; every bot-created issue assigned to the operator.

- [x] **Phase 1 — read.** `list_tasks` queries vault + Linear and merges.
- [x] **Phase 2 — write.** Capturing an actionable task mirrors to a Linear issue (priority/deadline/label/state/assignee) and writes `linear_id`/`linear_url` back into the vault; edits and drops propagate.
- [ ] **Phase 3 — brief reads Linear.** The daily brief is still vault-only; it should read live Linear state (incl. teammate changes), merged + grouped by project.
- [ ] **Phase 4 — migrate legacy tasks.** One-shot script: existing project-tagged vault tasks (pre-Phase-2) → create Linear issues, write back the cross-ref. Also decide whether `update_task` should mirror on a vault-only→actionable type change.

Runtime detail: [`docs/integrations/linear.md`](integrations/linear.md).

## Phase 4 — Intelligence

- [ ] RSS ingester in `intake/signals.ts` — per-project watchlists
- [ ] Selective web fetch + LLM summarization (use Claude's `web_fetch_20260209` server tool)
- [ ] Proactive nudges: "your cold lead X just posted Y"
- [ ] Expand Intelligence Monitor to produce a weekly "what changed in my world" digest

## Phase 5 — Autonomy expansion

- [ ] Google Calendar read integration → real "today's schedule" in daily brief
- [ ] Email forward-to-address → inbox capture (SES or Resend inbound)
- [ ] Semantic search over vault (embeddings) — only when your vault has enough content to justify it
- [ ] Per-project sub-agents: e.g. a BidaWash-specific agent with SOPs

## Operating loop

Every Sunday during the weekly review:
1. Read the Hard Truth section.
2. Update the `_project.md` North Star for each active project if it shifted.
3. If Chief of Staff tone drifted, edit `apps/backend/src/agents/prompts/chief-of-staff.md` and redeploy.
4. Audit SQLite `cron_runs` for errors: `sqlite3 data/council.sqlite "SELECT * FROM cron_runs WHERE status='error' ORDER BY id DESC LIMIT 10"`.
