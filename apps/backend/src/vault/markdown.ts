/**
 * Replace the body of a `## Heading` section in a Markdown document with new
 * content. If the heading does not yet exist, append the section at the end.
 *
 * "Section body" means every line AFTER the heading until just before the next
 * `## ` heading (or end of file). Subheadings (### and deeper) are treated as
 * part of the body and stay with the section being replaced.
 *
 * Pure string operation — no I/O, used by both vault project files and the
 * Linear project description so they stay in sync via the same primitive.
 *
 * @param body        Full Markdown body (no YAML frontmatter).
 * @param heading     Exact heading text, without the leading `##`. Match is
 *                    case- and whitespace-sensitive (`Key people`, not
 *                    `key people` or `Key People`).
 * @param newContent  New section body. Trailing newline is normalized; an
 *                    empty string leaves the heading with an empty section.
 */
export function replaceMarkdownSection(
  body: string,
  heading: string,
  newContent: string,
): string {
  const lines = body.split("\n");
  const headingPattern = new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$`);
  const headingIdx = lines.findIndex((l) => headingPattern.test(l));

  if (headingIdx === -1) {
    // Append the section with consistent spacing. A blank line separates it
    // from whatever preceded — unless the body was empty to begin with.
    const trimmed = body.replace(/\n+$/, "");
    const sep = trimmed.length > 0 ? "\n\n" : "";
    return `${trimmed}${sep}## ${heading}\n${newContent}\n`;
  }

  // Find the next `## ` heading after this one (or EOF).
  let nextIdx = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      nextIdx = i;
      break;
    }
  }

  const before = lines.slice(0, headingIdx + 1); // up to and including the heading line
  const after = lines.slice(nextIdx); // from the next heading onward (may be empty)

  // Tack a trailing blank onto the new section so it visually separates from
  // the following heading. Empty newContent stays empty (no spurious blank).
  const newSection =
    newContent === "" ? [""] : [...newContent.split("\n"), ""];

  // Collapse any accidental triple+ blank runs to keep output tidy.
  return [...before, ...newSection, ...after].join("\n").replace(/\n{3,}/g, "\n\n");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
