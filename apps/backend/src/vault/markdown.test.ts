import { describe, it, expect } from "vitest";
import { replaceMarkdownSection } from "./markdown.js";

const SAMPLE = [
  "# BidaWash",
  "",
  "## North star",
  "the goal",
  "",
  "## Key people",
  "- old item",
  "",
  "## Links",
  "- link",
].join("\n");

describe("replaceMarkdownSection", () => {
  it("replaces an existing section's body, preserving surrounding sections", () => {
    const out = replaceMarkdownSection(
      SAMPLE,
      "Key people",
      "- **Christian** — Operations\n- **Carlo** — Project Engineer",
    );
    expect(out).toContain("## Key people\n- **Christian** — Operations\n- **Carlo** — Project Engineer");
    expect(out).toContain("## North star\nthe goal");
    expect(out).toContain("## Links\n- link");
    expect(out).not.toContain("- old item");
  });

  it("preserves the h1 title", () => {
    const out = replaceMarkdownSection(SAMPLE, "Key people", "- new");
    expect(out.startsWith("# BidaWash")).toBe(true);
  });

  it("appends the section at the end when the heading does not exist", () => {
    const out = replaceMarkdownSection(SAMPLE, "Team capacity", "- 3 FTE");
    expect(out).toContain("## Links\n- link");
    expect(out.endsWith("## Team capacity\n- 3 FTE\n")).toBe(true);
  });

  it("appends with no leading separator when the body is empty", () => {
    const out = replaceMarkdownSection("", "Notes", "first note");
    expect(out).toBe("## Notes\nfirst note\n");
  });

  it("replaces the last section (no following heading)", () => {
    const out = replaceMarkdownSection(SAMPLE, "Links", "- new link");
    expect(out).toContain("## Links\n- new link");
    expect(out).not.toContain("- link\n");
  });

  it("treats subheadings as part of the section body", () => {
    const body = [
      "## Outer",
      "para",
      "",
      "### Sub",
      "child",
      "",
      "## Next",
      "after",
    ].join("\n");
    const out = replaceMarkdownSection(body, "Outer", "fresh");
    expect(out).toContain("## Outer\nfresh");
    expect(out).not.toContain("### Sub");
    expect(out).toContain("## Next\nafter");
  });

  it("is case-sensitive (does not match different casing)", () => {
    const out = replaceMarkdownSection(SAMPLE, "key people", "- new");
    // Heading not matched → appended at end, original "Key people" untouched.
    expect(out).toContain("## Key people\n- old item");
    expect(out.endsWith("## key people\n- new\n")).toBe(true);
  });

  it("collapses triple+ newlines that the splice could produce", () => {
    const messy = "## A\n\n\n\n## B\nx";
    const out = replaceMarkdownSection(messy, "A", "fresh");
    expect(out).not.toMatch(/\n{3,}/);
  });

  it("clears the section when newContent is empty (heading remains)", () => {
    const out = replaceMarkdownSection(SAMPLE, "Key people", "");
    expect(out).toContain("## Key people");
    expect(out).not.toContain("- old item");
  });

  it("handles multi-line new content with internal blank lines", () => {
    const out = replaceMarkdownSection(SAMPLE, "Key people", "- one\n- two\n\n- three");
    expect(out).toContain("- one\n- two\n\n- three");
    expect(out).toContain("## Links\n- link");
  });
});
