# Roadmap

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

## Phase 1 — Local working v1 (this week)

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

## Phase 2 — Deployed & scheduled (week 2)

- [ ] Create Fly.io account + app: `fly launch`
- [ ] Attach persistent volume (3 GB) mounted at `/data`
- [ ] Point `DB_PATH=/data/council.sqlite`, `VAULT_PATH=/data/vault`
- [ ] Set secrets: `fly secrets set ANTHROPIC_API_KEY=... VAULT_REMOTE=... INTAKE_TOKEN=...`
- [ ] SSH key on the Fly machine or HTTPS clone with a deploy token
- [ ] Verify cron fires: check `/health`, tail logs at 07:00 local time
- [ ] Set up Anthropic budget alert ($25/month hard cap recommended)

## Phase 3 — WhatsApp two-way

- [ ] Create a Meta for Developers account
- [ ] Create a WhatsApp Business Account + app
- [ ] Grab a **free test phone number** from Meta (limited to 5 recipients — your personal number is fine)
- [ ] Set `WHATSAPP_*` env vars, toggle `WHATSAPP_ENABLED=true`
- [ ] Add Meta's webhook URL: `https://<your-fly-app>.fly.dev/webhooks/whatsapp` with your `WHATSAPP_VERIFY_TOKEN`
- [ ] Wire inbound payload parsing in `intake/http.ts::POST /webhooks/whatsapp`
  - Extract `entry[0].changes[0].value.messages[0].text.body`
  - Dispatch through `runChiefOfStaff`
  - Reply via `messenger.send(..., 'whatsapp')`
- [ ] Wire outbound daily brief to WhatsApp in `jobs/cron.ts`
- [ ] Cost: **free** at personal-use volume (1000 service conversations/month included)

When you scale beyond the test number: apply for a production number through Meta directly or via an aggregator like 360dialog. No Twilio markup.

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
