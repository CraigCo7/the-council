# Integration: Obsidian (the second brain)

**Role:** the canonical store. Everything The Council knows — tasks, ideas,
reminders, decisions, meetings, daily briefs, weekly reviews — lives here as
Markdown files. Linear is a *projection* of the actionable subset; Telegram is
just the chat surface. If the vault and any other system disagree, **the vault
wins.**

There is no "Obsidian API." Obsidian is a Markdown editor pointed at a folder.
The integration is really a **git integration**: the backend and your devices
share one private GitHub repo (`council-vault`), and Obsidian renders whatever
git has synced to your device.

```
   Backend (Fly machine)                 GitHub                  Your devices
  ┌────────────────────┐    git push   ┌──────────┐   git pull  ┌────────────┐
  │ /data/vault (clone)│ ────────────▶ │ council- │ ──────────▶ │  Obsidian  │
  │  pull → write →    │ ◀──────────── │  vault   │ ◀────────── │ (+ Working │
  │  commit → push     │    git pull   │ (private)│   git push  │   Copy)    │
  └────────────────────┘               └──────────┘             └────────────┘
```

See also [`docs/VAULT.md`](../VAULT.md) for folder/naming conventions and
[`docs/TASK-LIFECYCLE.md`](../TASK-LIFECYCLE.md) for the full end-to-end task flow.

---

## Plain-English: what happens when the vault is used

There are two directions, and they meet at GitHub.

**Alfred writes (the common case).** When you capture or change a task via
Telegram, the backend writes a Markdown file into its local copy of the vault,
`git commit`s it, and `git push`es to GitHub — all within the same operation.
By the time you see the `✓ Captured` receipt, the file is already on GitHub.
Pull on your laptop and Obsidian shows the new note.

**You write (editing in Obsidian).** You can open any note in Obsidian, edit it
by hand, and push to GitHub (via Working Copy on iOS, MGit/Termux on Android, or
plain `git` on a laptop). The backend **pulls before every write**, so your
manual edits flow back in and Alfred doesn't clobber them — as long as you and
Alfred aren't editing the *same* file at the same moment (see Conflicts).

Nothing about the vault requires Obsidian specifically. Obsidian is the nice
reading/editing layer; the durable thing is "Markdown files in a git repo."

---

## How a write actually works

> Files: [`vault/client.ts`](../../apps/backend/src/vault/client.ts),
> [`vault/fs.ts`](../../apps/backend/src/vault/fs.ts),
> [`vault/tasks.ts`](../../apps/backend/src/vault/tasks.ts),
> orchestrated from [`tools/dispatch.ts`](../../apps/backend/src/tools/dispatch.ts)

Every actionable tool call (`create_task`, `update_task`, `delete_task`) runs
the same three-step dance:

1. **`syncPull()`** — `git pull --rebase origin main` on `/data/vault`. Pulls in
   anything you edited in Obsidian since the last interaction. A failure here is
   **non-fatal**: it logs `vault pull failed — continuing with local state` and
   proceeds, so a transient network blip never blocks a capture.
2. **Write the file** — `createTask` / `updateTask` / `deleteTask` build the
   frontmatter and body, then `writeMarkdown` serializes it with
   [`gray-matter`](https://github.com/jonschlinkert/gray-matter) (YAML
   frontmatter + Markdown body). New tasks get an ID `T-<YYYYMMDD>-<slug>` and
   land at `02-Tasks/<year>/<id>.md`; the year is parsed straight out of the ID.
3. **`commitAndPush()`** — stages *only the specific file* (never `git add -A`),
   commits with a structured message (`task: capture T-… — <title>`), and pushes.
   If the push fails, the commit stays local and rides along on the next push;
   the data is safe, just not yet on GitHub.

One logical change = one commit. Read-only operations (`list_tasks`,
`list_overdue`) never commit.

### Safety rails on writes

- **Path-escape guard.** `vaultResolve()` ([`fs.ts`](../../apps/backend/src/vault/fs.ts))
  rejects any path that resolves outside the vault root — the model can't be
  tricked into writing to `/etc` or `../`.
- **Schema validation.** Every write re-validates the full frontmatter through
  the Zod `TaskFrontmatter` schema ([`schemas.ts`](../../apps/backend/src/vault/schemas.ts))
  before the file is serialized. A malformed patch fails loudly in logs rather
  than corrupting a note.
- **Slugs are computed, not model-authored.** `slugify()` lowercases, strips to
  `[a-z0-9-]`, and caps at 48 chars. The model never invents file paths.

---

## What a task file looks like

The Zod schema in [`schemas.ts`](../../apps/backend/src/vault/schemas.ts) is
authoritative. A captured task on disk:

```markdown
---
id: T-20260506-call-wendy
title: Call Wendy
type: task                  # task | idea | reminder | delegated | waiting-for
status: open                # open | in_progress | blocked | done | dropped
project: BidaWash           # one of the configured PROJECTS
priority: P2                # P0 | P1 | P2 | P3
deadline: 2026-05-07        # ISO date, or null
created: 2026-05-06T14:02:00+08:00
updated: 2026-05-06T14:02:00+08:00
tags: []
waiting_on: null            # who you're blocked on (waiting-for / delegated)
links: []
source: chat                # chat | whatsapp | manual | system | cli | http
linear_id: CNCL-42          # cross-ref to the mirrored Linear issue, or null
linear_url: https://linear.app/the-council-alfred/issue/CNCL-42
---

## Context
_(captured)_

## Log
- 2026-05-06 — captured
```

The `linear_id` / `linear_url` fields are the bridge to the
[Linear integration](./linear.md): they're written back into the vault after a
Linear issue is created, so the vault note always points at its projection.

Dates are stored as **ISO** here (sortable, queryable, plays nicely with
Obsidian Dataview). They're only humanized to "May 7 2026" at the
[Telegram boundary](./telegram.md) — the vault never sees the friendly form.

---

## Where the files live

Folders are documented in full in [`docs/VAULT.md`](../VAULT.md). The ones the
backend writes to:

| Path | Written by | When |
|---|---|---|
| `02-Tasks/<YYYY>/T-….md` | `create_task` / `update_task` | every capture / edit |
| `09-Briefs/<YYYY-MM-DD>.md` | daily-brief cron | 07:00 Manila |
| `04-Weekly/<YYYY-Www>.md` | weekly-review cron | Sun 18:00 Manila |
| `05-Decisions/` `07-Waiting-For/` `08-Ideas/` | various | as classified |

Deleting a task (`delete_task`) removes the Markdown file and commits the
removal (`task: drop T-… — <title>`) — it's a normal git deletion, recoverable
from history.

---

## Storage & deployment notes

- The backend's working copy lives at **`/data/vault`** (`VAULT_PATH`), on Fly's
  **persistent volume** — so it survives restarts and isn't re-cloned on every
  deploy. If `/data/vault/.git` is missing on boot, the client clones fresh from
  `VAULT_REMOTE` ([`client.ts`](../../apps/backend/src/vault/client.ts)).
- `VAULT_REMOTE` is an HTTPS GitHub URL with a fine-grained PAT embedded — that
  PAT is what authenticates clone/pull/push. It's a Fly secret; never commit it.
- The vault is the **only** durable store. SQLite (`/data/council.sqlite`) holds
  operational state — message history, webhook dedupe, cron runs, cost records —
  and is disposable. Lose it and you lose conversation memory, not task data.

---

## Conflicts & failure modes

| Situation | What happens | Mitigation |
|---|---|---|
| You edit a task in Obsidian, Alfred edits a *different* task | Clean — `pull --rebase` merges non-overlapping changes | None needed |
| You and Alfred edit the **same** task concurrently | `pull --rebase` may conflict; the write proceeds on local state and `push` may fail non-fast-forward | For v1, don't edit the same note in Obsidian and via Alfred at the same time. Resolve via SSH + manual `git pull --rebase` |
| `git push` fails (network / PAT) | Commit stays local; logged `vault push failed — commit is local only`; next push carries it | Self-heals on next write; check `fly logs` if persistent |
| PAT expired / revoked | Pull and push start failing; captures still write locally | Rotate the PAT and `fly secrets set VAULT_REMOTE=…` |
| Bad patch / schema violation | Zod parse error in logs; file not corrupted | Fix the input and re-issue |

---

## Where to look in code

| Concern | File |
|---|---|
| Clone / pull / commit / push | [`vault/client.ts`](../../apps/backend/src/vault/client.ts) |
| Read/write Markdown, path-escape guard, slugify | [`vault/fs.ts`](../../apps/backend/src/vault/fs.ts) |
| Task CRUD (create/read/update/delete/list/overdue) | [`vault/tasks.ts`](../../apps/backend/src/vault/tasks.ts) |
| Frontmatter Zod schemas | [`vault/schemas.ts`](../../apps/backend/src/vault/schemas.ts) |
| ISO date/time helpers (Manila TZ) | [`vault/time.ts`](../../apps/backend/src/vault/time.ts) |
| The glue that calls all of the above | [`tools/dispatch.ts`](../../apps/backend/src/tools/dispatch.ts) |
| Folder & naming conventions | [`docs/VAULT.md`](../VAULT.md) |
