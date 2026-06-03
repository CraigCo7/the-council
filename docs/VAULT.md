# Vault conventions

## Folder structure

| Path | Purpose | Writer |
|---|---|---|
| `00-Inbox/` | Unfiled capture | Chief of Staff triage |
| `01-Projects/<Name>/` | Project dashboard + loose notes | Operator + Chief of Staff |
| `01-Projects/<Name>/_project.md` | Project dashboard (frontmatter) | Operator |
| `02-Tasks/<YYYY>/T-<YYYYMMDD>-<slug>.md` | Individual task files | Backend |
| `03-Daily/<YYYY-MM-DD>.md` | Daily notes | Either |
| `04-Weekly/<YYYY-Www>.md` | Weekly reviews | Backend |
| `05-Decisions/D-<YYYYMMDD>-<slug>.md` | Decision log | Backend + Operator |
| `06-Meetings/M-<YYYYMMDD>-<slug>.md` | Meeting notes | Operator |
| `07-Waiting-For/` | External dependencies | Backend |
| `08-Ideas/` | Not-yet-tasks | Either |
| `09-Briefs/<YYYY-MM-DD>.md` | Generated daily briefs | Backend |
| `_templates/` | Obsidian Templater sources | Operator |
| `_system/` | Backend bookkeeping (indexes, etc.) | Backend |

## Naming

| Entity | Format | Example |
|---|---|---|
| Task | `T-<yyyymmdd>-<slug>.md` | `T-20260423-renew-bidawash-insurance.md` |
| Decision | `D-<yyyymmdd>-<slug>.md` | `D-20260423-hire-va-for-puppery.md` |
| Meeting | `M-<yyyymmdd>-<slug>.md` | `M-20260423-kickoff-atin.md` |
| Daily | `<YYYY-MM-DD>.md` | `2026-04-23.md` |
| Weekly | `<YYYY-Www>.md` | `2026-W17.md` |

Slugs: lowercase, alphanumeric, hyphen-separated, ≤48 chars. Computed by `slugify()` in `apps/backend/src/vault/fs.ts`.

## Task frontmatter schema

See [`apps/backend/src/vault/schemas.ts`](../apps/backend/src/vault/schemas.ts) — the Zod schema is authoritative.

```yaml
---
id: T-20260423-renew-bidawash-insurance
title: Renew BidaWash business insurance
type: task                  # task | idea | reminder | delegated | waiting-for
status: open                # open | in_progress | blocked | done | dropped
project: BidaWash           # one of the configured projects
priority: P1                # P0 | P1 | P2 | P3
deadline: 2026-05-15        # ISO date or null
created: 2026-04-23T14:02:00+08:00
updated: 2026-04-23T14:02:00+08:00
tags: [ops, compliance]
waiting_on: null            # required if type=waiting-for
links: []                   # [[wikilinks]]
source: cli                 # chat | whatsapp | manual | system | cli | http
linear_id: null             # cross-ref to mirrored Linear issue (e.g. CNCL-42), or null
linear_url: null            # canonical Linear issue URL, or null
---
```

The `linear_id` / `linear_url` fields link a task to its [Linear](integrations/linear.md) projection — populated when an actionable task is mirrored. See [integrations/obsidian.md](integrations/obsidian.md) for the full write flow.

## Priorities

- **P0** — urgent + critical. Drop everything.
- **P1** — important, single-digit days. Daily-brief top section.
- **P2** — normal. Default.
- **P3** — someday / low. Excluded from deadline sweeps.

## Generated markers

Backend-generated sections that support in-place regeneration are delimited:

```markdown
<!-- council:generated:start -->
...auto-generated content...
<!-- council:generated:end -->
```

Edits outside these markers survive regeneration. (v1 briefs are fully regenerated — markers are used only for index files.)

## Conflicts

- Backend always pulls --rebase before any write.
- If a conflict occurs, the commit is kept local and logged (`vault push failed`); the operator resolves manually.
- For routine cases (operator edits a task on the phone while backend updates it), Git's 3-way merge handles non-overlapping hunks fine — frontmatter tends to be the only overlap and is usually from one side.

## Working from phone

- **iOS**: [Working Copy](https://workingcopy.app) or [a-Shell](https://holzschu.github.io/a-Shell_iOS/) for git pull/push.
- **Android**: [MGit](https://play.google.com/store/apps/details?id=com.manichord.mgit) or Termux.
- Or just interact via [Telegram](integrations/telegram.md) — the backend handles all vault I/O.
