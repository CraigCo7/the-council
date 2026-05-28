# Integration: Linear (the task tracker)

**Role:** a *projection* of the actionable subset of the vault, for eventual
team sharing. The [vault](./obsidian.md) is canonical and holds everything;
Linear holds the slice that's real, assignable work. The rule, per capture, is:
the note always goes to the vault, and *if* it's actionable it also gets mirrored
to a Linear issue.

Linear is **optional and gracefully degradable**. It's "on" only when both
`LINEAR_API_KEY` and `LINEAR_TEAM_KEY` are set. When off — or when the Linear
API is unreachable — the system runs vault-only: captures still commit, and
`list_tasks` still returns vault results. Linear failures are **never fatal**;
the dispatcher commits the vault regardless and surfaces a `linear_warning` for
Alfred to mention.

See [`docs/TASK-LIFECYCLE.md`](../TASK-LIFECYCLE.md) for the broader flow.

---

## The shape of the workspace

Linear's free tier caps at **2 teams**, so ventures are *not* separate teams.
Instead:

- **One team** — "The Council", key `CNCL`. Every issue lives here.
- **Five Projects** — `BidaWash`, `Puppery`, `ATIN`, `YNG`, `Personal`. The vault
  `project` maps 1:1 to a Linear Project of the same name.
- **Employees are labels, not users.** Jake, Christian, Carlo, Eileen exist as
  labels, because free-tier seats are scarce. A task's `waiting_on` name is
  matched to the label of the same name.
- **Everything is assigned to the operator.** Every bot-created issue is
  auto-assigned to the API-key owner (resolved via `client.viewer`), so the
  operator's "My Issues" view is comprehensive. The employee label still flags
  who's actually doing the work.

The second team slot is reserved for the first real hire.

---

## Plain-English: what happens when Linear is used

**On capture.** If you capture something actionable ("renew the BidaWash
insurance", "Christian is handling the deep clean"), the backend writes the vault
note *and* creates a matching Linear issue in the right Project, with priority,
due date, employee label, and assignee set. It then writes the issue's ID
(`CNCL-42`) and URL back into the vault note, and your Telegram receipt includes
a tappable `[CNCL-42](…)` link.

**On edit.** If you later change that task — reprioritize, set a deadline, move
projects, mark it done — and the vault note has a `linear_id`, the same change is
pushed to the Linear issue (status → workflow state, priority, due date, project,
employee label). A progress note becomes a Linear comment.

**On drop.** Dropping a task archives the Linear issue (soft delete — recoverable
in Linear's UI, hidden from default views).

**On status queries.** "What's on my plate", "what's Christian doing" — these
read from **both** the vault and Linear in parallel and merge the results, so
you see live issue state (including changes a teammate made in Linear directly),
not just what the vault last recorded.

---

## What gets mirrored (and what doesn't)

> [`shouldMirrorToLinear()`](../../apps/backend/src/linear/createIssue.ts)

Mirrored to Linear:

| Vault `type` | Mirrored? | Why |
|---|---|---|
| `task` | ✅ | the operator's own actionable work |
| `delegated` | ✅ | someone else's work to track |
| `waiting-for` | ✅ | blocked on an external party (issue set to **Blocked**) |
| `idea` | ❌ | not yet actionable — vault-only |
| `reminder` | ❌ | a nudge, not trackable work — vault-only |

This is why "remind me to *do real work*" is classified as `task`, not
`reminder` — a `reminder` would never reach the team board.

---

## The data mappings

> [`linear/mapping.ts`](../../apps/backend/src/linear/mapping.ts)

**Priority** (vault `P0–P3` ↔ Linear `0–4`):

| Vault | Linear |
|---|---|
| P0 | 1 (Urgent) |
| P1 | 2 (High) |
| P2 | 3 (Medium) |
| P3 | 4 (Low) |
| — | 0 (No priority) → **P3** when reading back |

**Status → Linear workflow state** (vault → Linear, on update):

| Vault status | Linear state name |
|---|---|
| open | Todo |
| in_progress | In Progress |
| blocked | Blocked |
| done | Done |
| dropped | Canceled |

**Linear state → vault** (when reading): mapped by Linear's state *group*
(`backlog`/`unstarted`/`triage` → open, `started` → in_progress, `completed` →
done, `canceled` → dropped). A state literally **named "Blocked"** always maps to
`blocked` regardless of its group — so it doesn't matter whether you filed your
Blocked state under Unstarted or Started.

Linear has no `type` field, so issues read back from Linear are always typed
`task`.

---

## How it's wired (technical)

Direct Linear GraphQL via the official `@linear/sdk` package — not MCP. Chosen
for consistency with the existing tool dispatcher, privacy (no third-party
passthrough), and selective tool exposure (no admin/destructive ops).

- **Client** ([`client.ts`](../../apps/backend/src/linear/client.ts)) — lazy
  singleton; `linearEnabled()` gates everything; `linearIssueUrl()` builds the
  canonical URL from `LINEAR_WORKSPACE_SLUG`.
- **Lookups** ([`lookups.ts`](../../apps/backend/src/linear/lookups.ts)) — Linear
  mutations need UUIDs, but we operate on names. On first use, this resolves and
  **caches** the team ID, the operator's user ID (`client.viewer`), and name→ID
  maps for projects, labels, and workflow states. The cache lives for the process
  lifetime and invalidates implicitly on redeploy — so if you add a Project or
  label in Linear's UI, redeploy (or restart) to let the bot see it.
- **Create** ([`createIssue.ts`](../../apps/backend/src/linear/createIssue.ts)) —
  resolves the Project by name (unknown name → fail), matches `waiting_on` to an
  employee label (no match → the name goes in the description so intent isn't
  lost), sets `waiting-for` issues to Blocked, assigns to the operator.
- **Update** ([`updateIssue.ts`](../../apps/backend/src/linear/updateIssue.ts)) —
  applies only the fields that changed. Employee-label replacement reads the
  current labels, strips the existing employee label, and adds the new one
  (Linear replaces the label array wholesale). `logEntry` becomes a comment, and
  a failed comment doesn't fail the update.
- **List** ([`listIssues.ts`](../../apps/backend/src/linear/listIssues.ts)) —
  team + project + `noDeadline` filters are pushed server-side; `status` and
  `waitingOn` are filtered post-fetch. Any API error returns `[]` so vault
  results still flow.
- **Archive** ([`archiveIssue.ts`](../../apps/backend/src/linear/archiveIssue.ts))
  — soft delete (Linear has no SDK hard-delete; archive is the right semantics
  for "drop this").

The orchestration — write vault first, mirror to Linear, write the cross-ref
back — lives in [`tools/dispatch.ts`](../../apps/backend/src/tools/dispatch.ts).

---

## Failure modes & guarantees

| Situation | What happens |
|---|---|
| Linear disabled (no key/team) | Vault-only; `list_tasks` returns vault rows; no issues created |
| Linear API down / errors on create | Vault task is still committed; `linear_warning` set; no `linear_id` written |
| Linear API down on list | Linear contributes `[]`; vault rows still returned |
| Unknown Project name | Create fails with a clear error (the prompt enums Projects, so this shouldn't happen) |
| `waiting_on` doesn't match a label | Label skipped; name added to the issue description |
| Issue archived in Linear, edited via vault | Update targets the archived issue; logged warning |

**Invariant:** the vault is always written/committed first and independently.
Linear is best-effort mirroring on top.

---

## Known gaps (roadmap)

- **Daily brief is still vault-only.** It doesn't yet read live Linear state.
  (Planned "Phase 3".)
- **Pre-existing tasks aren't migrated.** Tasks captured before Linear write
  support won't have a `linear_id` until a one-shot migration runs. (Planned
  "Phase 4".)
- **Type change doesn't back-fill Linear.** Only `create_task` mirrors. If you
  `update_task` a vault-only `idea`/`reminder` into a `task`, no Linear issue is
  created retroactively.

---

## Configuration

Set as Fly secrets (never echoed/committed):

| Secret | Purpose |
|---|---|
| `LINEAR_API_KEY` | Personal API key (Settings → API). Empty = disabled |
| `LINEAR_TEAM_KEY` | `CNCL` — the single team |
| `LINEAR_WORKSPACE_SLUG` | `the-council-alfred` — used to build issue URLs |
| `OPERATOR_TEAM_MEMBERS` | `Jake,Christian,Carlo,Eileen` — names matched to labels |

---

## Where to look in code

| Concern | File |
|---|---|
| Enable check, client, URL builder | [`linear/client.ts`](../../apps/backend/src/linear/client.ts) |
| Name→UUID lookups + operator user ID | [`linear/lookups.ts`](../../apps/backend/src/linear/lookups.ts) |
| Create issue + `shouldMirrorToLinear` | [`linear/createIssue.ts`](../../apps/backend/src/linear/createIssue.ts) |
| Update issue (status/priority/labels/comment) | [`linear/updateIssue.ts`](../../apps/backend/src/linear/updateIssue.ts) |
| List + merge into task shape | [`linear/listIssues.ts`](../../apps/backend/src/linear/listIssues.ts) |
| Archive (soft delete) | [`linear/archiveIssue.ts`](../../apps/backend/src/linear/archiveIssue.ts) |
| Priority/status mappings | [`linear/mapping.ts`](../../apps/backend/src/linear/mapping.ts) |
| Vault↔Linear orchestration | [`tools/dispatch.ts`](../../apps/backend/src/tools/dispatch.ts) |
