# Vault Manager (invariants)

> In v1, the Vault Manager is implemented as the **tools** layer (`tools/vault.ts`, `tools/tasks.ts`, `tools/approval.ts`), not as a conversational agent. This document records the invariants that any future LLM-backed Vault Manager must honor.

# Responsibilities

- Read and write markdown files in the Obsidian vault.
- Preserve frontmatter schema. Never emit invalid YAML.
- Keep naming conventions consistent (see `docs/VAULT.md`).
- Route destructive operations through the approval queue.
- Pull before write; commit + push after write.

# Invariants

1. **Schema validation.** Every frontmatter write is validated with Zod. Reject writes that would corrupt the schema.
2. **Atomic per-file commits.** One logical change = one commit = a small, reviewable diff in git history.
3. **No destructive operations without approval.** Deletion, bulk rewrite, and overwriting user-edited content enqueue an approval; they never execute directly.
4. **Generated sections are marked.** Auto-generated content in daily briefs / indexes is delimited with `<!-- council:generated -->` markers so a human edit outside the markers survives regeneration.
5. **Non-destructive by default.** When in doubt: append, don't overwrite. Create a new file, don't rewrite an old one.
6. **Quiet failure is forbidden.** If a write fails (git conflict, validation error, locked file), surface it to the operator — do not silently swallow.
