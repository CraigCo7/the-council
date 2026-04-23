# The Council

Personal executive-assistant / team-of-agents system for Craig.

- **Vault is source of truth.** All state — tasks, decisions, briefs — lives as markdown in a Git-backed Obsidian vault.
- **Chief of Staff routes; specialists execute.** Task Operator, Strategic Analyst, Intelligence Monitor, Vault Manager.
- **Cloud-deployed.** Works when your laptop is closed; interacts via WhatsApp (phase 3) or HTTP.
- **Cost-conscious.** Tiered models: Haiku routine, Sonnet briefs, Opus weekly review + strategic pressure-testing.

## Stack

- Node 20 + TypeScript (strict)
- Fastify (HTTP), SQLite (operational state), `simple-git` (vault sync), `node-cron` (schedules)
- Anthropic SDK direct (`@anthropic-ai/sdk`) with prompt caching
- Obsidian vault in a separate private GitHub repo
- Deploy target: Fly.io (persistent volume for vault clone + SQLite)

## Prerequisites

1. **Node 20+** and **pnpm**:
   ```sh
   brew install node pnpm
   ```
2. **Git** and **GitHub CLI**:
   ```sh
   brew install git gh
   gh auth login
   ```
3. **Anthropic API key** — create at <https://console.anthropic.com>. Set a monthly spend cap (recommend $25 to start).

## First-time setup

```sh
# 1. Install dependencies
pnpm install

# 2. Create the vault GitHub repo + push the seed structure
pnpm bootstrap-vault
# → creates https://github.com/CraigCo7/council-vault (private)
# override with: REPO=owner/name VISIBILITY=private pnpm bootstrap-vault

# 3. Configure env
cp apps/backend/.env.example apps/backend/.env
# edit apps/backend/.env — at minimum:
#   ANTHROPIC_API_KEY
#   VAULT_REMOTE (use the SSH URL the bootstrap step printed)
#   INTAKE_TOKEN (generate: openssl rand -hex 32)

# 4. First run — clones the vault under ./vault
pnpm cli
```

## Running

### CLI (development)

```sh
pnpm cli
# Type freely — Chief of Staff routes, creates tasks, consults specialists.
# Ctrl+C to exit.
```

### HTTP server

```sh
pnpm dev      # dev with watch
pnpm start    # production (after `pnpm build`)
```

Then:

```sh
# Send a message
curl -X POST http://localhost:8080/message \
  -H "Authorization: Bearer $INTAKE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"renew the bidawash insurance before may 15"}'

# Generate a daily brief on demand
curl -X POST http://localhost:8080/briefs/daily \
  -H "Authorization: Bearer $INTAKE_TOKEN"

# List pending approvals
curl http://localhost:8080/approvals \
  -H "Authorization: Bearer $INTAKE_TOKEN"

# Approve one
curl -X POST http://localhost:8080/approvals/17/resolve \
  -H "Authorization: Bearer $INTAKE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"decision":"approve"}'
```

### Scheduled jobs

Daily brief (07:00 local), weekly review (Sunday 18:00), and hourly deadline sweep run automatically while the server is up. Timezone is controlled by `OPERATOR_TIMEZONE` in `.env`.

## Project layout

```
the-council/
├── apps/backend/          # the service
│   └── src/
│       ├── agents/        # Chief of Staff, Strategic Analyst, etc.
│       ├── tools/         # tool definitions + dispatcher
│       ├── vault/         # git client, fs, schemas, tasks
│       ├── briefs/        # daily + weekly generators
│       ├── intake/        # HTTP, CLI, WhatsApp (stub)
│       ├── approvals/     # destructive-edit queue
│       ├── jobs/          # cron
│       └── messenger/     # outbound delivery (console + WhatsApp)
├── vault-template/        # seed content pushed to council-vault
├── scripts/               # bootstrap-vault, admin utilities
└── docs/                  # ARCHITECTURE, VAULT, ROADMAP
```

## What's in v1

- ✅ CLI chat end-to-end: Chief of Staff → tools → vault commit + push.
- ✅ Structured tasks (frontmatter + Zod schema).
- ✅ Daily brief + weekly review generators.
- ✅ Approval queue for destructive edits.
- ✅ Cron jobs scheduled in the operator's timezone.
- ✅ HTTP intake endpoint (token-auth).
- ✅ WhatsApp stub ready for Phase 3.

## What's next

See [docs/ROADMAP.md](docs/ROADMAP.md).

## Getting help

- `/help` in CLI
- Tail logs: `pnpm dev` prints structured output via pino-pretty.
- SQLite inspection: `sqlite3 apps/backend/data/council.sqlite '.tables'`
