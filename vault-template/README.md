# Council Vault

This is the source of truth for The Council — personal executive-assistant system.

## How to use

- **Primary surface: Obsidian.** Open the vault folder in Obsidian.
- **Source of truth: Git.** Every change (yours or the backend's) is committed.
- **No Obsidian Sync.** Pull before editing. Commit + push when you're done.

## Folder structure

| Folder | Purpose |
|---|---|
| `00-Inbox/` | Quick capture. Chief of Staff triages. |
| `01-Projects/` | One folder per project bucket with `_project.md` dashboard. |
| `02-Tasks/` | Individual task files, year-sharded. Source of truth for task state. |
| `03-Daily/` | Daily notes `YYYY-MM-DD.md`. |
| `04-Weekly/` | Weekly reviews `YYYY-Www.md`. |
| `05-Decisions/` | Decision log. |
| `06-Meetings/` | Meeting notes. |
| `07-Waiting-For/` | Items blocked on someone else. |
| `08-Ideas/` | Not-yet-tasks. |
| `09-Briefs/` | Generated daily briefs archive. |
| `_templates/` | Obsidian templates for manual use. |
| `_system/` | System-managed files (indexes, README). |

## Writing rules

- Backend-generated content is safe to hand-edit. Generated sections may be delimited by `<!-- council:generated -->` markers — edits outside the markers survive regeneration.
- Destructive edits by the backend (delete, bulk rewrite) always go through an approval queue. You are the only one who can approve them.

## Recommended Obsidian plugins

- **Dataview** — query task frontmatter (`priority`, `deadline`, `project`).
- **Templater** — use the templates in `_templates/`.
- **Git** — if you want Obsidian-side commits. Optional; the backend handles commits automatically.
