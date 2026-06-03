import { describe, it, expect } from "vitest";
import {
  renderKeyPeople,
  renderedBodySections,
  changedFields,
  BODY_SECTION_HEADINGS,
  UpdateProjectInput,
} from "./projects.js";

describe("renderKeyPeople", () => {
  it("renders structured people as bold-name + em-dash role bullets", () => {
    expect(
      renderKeyPeople([
        { name: "Christian", role: "Operations" },
        { name: "Carlo", role: "Project Engineer" },
      ]),
    ).toBe("- **Christian** — Operations\n- **Carlo** — Project Engineer");
  });

  it("omits the em-dash when no role is given", () => {
    expect(renderKeyPeople([{ name: "Sam" }])).toBe("- **Sam**");
  });

  it("renders an explicit empty list as a visible '(none)' marker", () => {
    expect(renderKeyPeople([])).toBe("_(none)_");
  });
});

describe("renderedBodySections", () => {
  it("maps only the provided fields to their headings", () => {
    const out = renderedBodySections(
      UpdateProjectInput.parse({
        project: "BidaWash",
        key_people: [{ name: "Christian", role: "Operations" }],
        north_star: "ship beta by Q3",
      }),
    );
    expect(out).toEqual({
      "North star": "ship beta by Q3",
      "Key people": "- **Christian** — Operations",
    });
  });

  it("returns {} when no body fields are present (frontmatter-only patch)", () => {
    const out = renderedBodySections(
      UpdateProjectInput.parse({ project: "BidaWash", status: "paused" }),
    );
    expect(out).toEqual({});
  });

  it("renders all five body sections together when all are patched", () => {
    const out = renderedBodySections(
      UpdateProjectInput.parse({
        project: "BidaWash",
        north_star: "ns",
        current_focus: "cf",
        blockers: "bl",
        key_people: [],
        links: "li",
      }),
    );
    expect(Object.keys(out).sort()).toEqual(
      ["Blockers", "Current focus", "Key people", "Links", "North star"],
    );
    expect(out["Key people"]).toBe("_(none)_");
  });
});

describe("changedFields", () => {
  it("lists exactly the patched fields, excluding 'project'", () => {
    const f = changedFields(
      UpdateProjectInput.parse({
        project: "BidaWash",
        status: "paused",
        key_people: [{ name: "Christian" }],
      }),
    );
    expect(f.sort()).toEqual(["key_people", "status"]);
  });

  it("returns [] when only project is given (no-op patch)", () => {
    const f = changedFields(UpdateProjectInput.parse({ project: "BidaWash" }));
    expect(f).toEqual([]);
  });
});

describe("BODY_SECTION_HEADINGS", () => {
  it("keys correspond 1:1 to UpdateProjectInput body fields", () => {
    // If a new body field is added to UpdateProjectInput, this map must be
    // updated too — otherwise the Linear mirror won't sync the new section.
    expect(Object.keys(BODY_SECTION_HEADINGS).sort()).toEqual(
      ["blockers", "current_focus", "key_people", "links", "north_star"],
    );
  });
});
