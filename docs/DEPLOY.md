# Deploy — Phase 2

Target: [Fly.io](https://fly.io) shared-cpu-1x machine in `sin` (Singapore — closest currently-available Fly region to Manila; `hkg` is no longer accepting new apps), always-on, with a 3 GB persistent volume at `/data` holding both the cloned vault repo and the SQLite state.

Cost at this config: **~$2–4/month** (always-on shared-cpu-1x) + Anthropic API usage (~$8–20/month at typical personal load). Free-tier credits ($5/month on new Fly accounts) cover most of the hosting.

---

## Prerequisites

- **Fly account.** `https://fly.io/app/sign-up` — credit card required, but the free tier covers small workloads.
- **`flyctl` CLI.** `brew install flyctl` then `fly auth login`.
- **GitHub personal access token** with read+write access to `council-vault`. A [fine-grained token](https://github.com/settings/tokens?type=beta) scoped to that single repo is strongly preferred over a classic PAT:
  - Resource owner: your user
  - Repository access: only `council-vault`
  - Permissions → Repository → `Contents`: **Read and write**
- **Your existing working local setup** (Phase 1 verified — CLI talks to the vault, caching activates).

---

## One-time setup

These steps run once per project. If you're redeploying after changes, skip to [§Deploy](#deploy).

### 1. Create the Fly app (does not deploy yet)

From the repo root:

```sh
fly launch --no-deploy --copy-config --region sin
```

- `--copy-config` keeps the `fly.toml` that's already in the repo (and uses its `app` value as the name).
- `--no-deploy` waits to actually push the image until secrets + volume exist.
- Answer **no** to any "would you like to set up a database / Redis / Tigris" prompts. We don't need them.

**App name note**: Fly app names are globally unique across all of Fly. If the `app` value in `fly.toml` is already taken, `fly launch` will auto-generate one like `the-council-empty-voice-9193` and rewrite your local `fly.toml` to match. That's fine — the URL becomes `https://<that-name>.fly.dev` and you reference it via `--app <that-name>` in subsequent commands. If you'd prefer a cleaner name, edit `fly.toml`'s `app` value to something likely-unused (e.g., `<yourhandle>-council`) before running `fly launch`.

### 2. Create the persistent volume

```sh
fly volumes create council_data --size 3 --region sin
```

3 GB is plenty — the vault is plain markdown and the SQLite DB stays small.

### 3. Set the three required secrets

```sh
# Anthropic API key — from console.anthropic.com
fly secrets set ANTHROPIC_API_KEY=sk-ant-...

# HTTP intake token — match whatever is in your local .env, or generate fresh:
fly secrets set INTAKE_TOKEN=$(openssl rand -hex 32)

# Vault remote URL, with the GitHub PAT embedded so the container can clone
# + push without an SSH key. Format:
#   https://x-access-token:<TOKEN>@github.com/<owner>/<repo>.git
fly secrets set VAULT_REMOTE='https://x-access-token:ghp_YOUR_TOKEN@github.com/CraigCo7/council-vault.git'
```

Non-secret config (model names, cron schedules, operator profile, projects) already lives in `fly.toml` under `[env]` and does not need `fly secrets set`.

### 4. Set an Anthropic spend cap

In the Anthropic console → Billing → Usage limits: set a monthly hard cap (start with **$25** — well above expected usage, low enough to catch runaway loops). This is belt-and-suspenders; the app logs token usage on every call so surprise charges are unlikely, but a hard ceiling is free protection.

---

## Deploy

```sh
fly deploy
```

Fly builds the Dockerfile remotely and rolls the new image onto the machine. First deploy takes ~3–5 minutes (native `better-sqlite3` compile + cold image pull); subsequent deploys are faster.

Success looks like:

```
✓ Machine <id> [app] update succeeded
✓ Machine <id> [app] health check is passing
```

---

## Verify

Find your app name (visible in `fly.toml`'s `app` field, or via `fly apps list`) and store it for the rest of the session:

```sh
APP=<your-fly-app-name>     # e.g. the-council-empty-voice-9193
INTAKE=<your-intake-token>  # the value you saved from `openssl rand -hex 32`
```

Then:

```sh
# Machine status — should show one machine in `started` state with checks passing
fly status --app $APP

# Live logs (Ctrl+C to exit) — useful to tail while you smoke-test
fly logs --app $APP

# Healthcheck (no auth required)
curl https://$APP.fly.dev/health

# Full end-to-end check — sends a message through Chief of Staff,
# which will capture a task into the vault repo.
curl -X POST https://$APP.fly.dev/message \
  -H "Authorization: Bearer $INTAKE" \
  -H "Content-Type: application/json" \
  -d '{"text":"deploy smoke test — create a P3 task to verify Fly deploy ran"}'
```

Then check the `council-vault` repo on GitHub — a new commit under `02-Tasks/2026/` confirms end-to-end: HTTP → Chief of Staff → tool → vault clone in container → push to GitHub.

---

## Cron — what runs when

The machine fires three schedulers in-process (timezone: `OPERATOR_TIMEZONE = Asia/Manila`):

| Job              | Default schedule          | What it does                                          |
| ---------------- | ------------------------- | ----------------------------------------------------- |
| Daily brief      | `0 7 * * *` — 07:00 local | Writes `09-Briefs/YYYY-MM-DD.md` to the vault         |
| Weekly review    | `0 18 * * 0` — Sun 18:00  | Writes `04-Weekly/YYYY-Www.md`                        |
| Deadline sweep   | `0 * * * *` — hourly       | Logs overdue + due-today counts                       |

All three also expose manual trigger endpoints — `POST /briefs/daily`, `POST /briefs/weekly` — useful for immediate generation or catch-up after downtime.

---

## Common operations

```sh
# Rotate a secret (re-deploys automatically)
fly secrets set ANTHROPIC_API_KEY=sk-ant-new-value

# SSH into the running machine (debugging only)
fly ssh console

# Tail logs (auto-detects app from fly.toml in cwd)
fly logs

# Scale vertically if 512 MB is tight
fly scale memory 1024

# Pause the app (saves $ while keeping data)
fly scale count 0
# …to resume:
fly scale count 1
```

---

## Troubleshooting

**Healthcheck failing after first deploy.**
Almost always a missing secret. Check `fly logs` for `ANTHROPIC_API_KEY is required` / `VAULT_REMOTE is required` / `INTAKE_TOKEN must be at least 16 chars`. Set the missing secret, `fly deploy` again (or it will auto-redeploy on secret change).

**Vault clone fails: `fatal: Authentication failed`.**
Your `VAULT_REMOTE` is missing the token, or the token doesn't have `Contents: Read and write`. Rotate the PAT and `fly secrets set VAULT_REMOTE=...` again.

**Machine stops unexpectedly.**
Should not happen with `auto_stop_machines = "off"` in `fly.toml`. If it does, check `fly status` for OOM kills — bump memory if so.

**Daily brief didn't fire.**
Verify the machine is actually up around the scheduled local time: `fly status` + `fly logs`. Cron fires in-process; a stopped or crashed machine misses the window. Use `POST /briefs/daily` to generate the missed brief manually.

**`better-sqlite3` compile fails during build.**
Docker's Alpine base lacks a musl prebuild, so it compiles from source. If the build fails with a node-gyp error, the fix is almost always a mismatched Node version between the `builder` and `runtime` stages in the Dockerfile — both must be `node:20-alpine`.

---

## What's explicitly NOT in this deploy

These are intentionally deferred to later phases:

- **WhatsApp delivery** (Phase 3) — webhook routes are stubbed but inbound parsing + Meta Cloud API outbound aren't wired.
- **Email delivery fallback** — for now, read the daily brief in Obsidian on your phone via GitHub.
- **Horizontal scale** — single machine is correct for personal use. Two machines would require external cron to avoid duplicate job fires.
- **Database migrations framework** — SQLite schema is bootstrapped by `schema.sql` on startup; migrations will need real tooling if the schema ever changes in a non-additive way.
