import {
  branchSlug,
  derivePreviewId,
  isValidPreviewId,
  ticketFromBranch,
} from "../src/config/preview-id";

describe("preview ids", () => {
  it.each([
    ["feature/abc-123-add-thing", "abc-123"],
    ["ABC-123", "abc-123"],
    ["fix/ABC_42_typo", "abc-42"],
    ["proj-1234/some-work", "proj-1234"],
    ["hotfix", undefined],
    ["release2024", undefined],
    ["ab1-234", undefined],
    ["abc123", undefined],
  ])("extracts a ticket from %s", (branch, expected) => {
    expect(ticketFromBranch(branch)).toBe(expected);
  });

  it("falls back to the pull request number", () => {
    expect(derivePreviewId({ branch: "fix-typo", prNumber: 42 })).toBe("pr-42");
    expect(derivePreviewId({ branch: "feature/abc-123", prNumber: 42 })).toBe("abc-123");
    expect(derivePreviewId({ prNumber: "7" }, "pr")).toBe("pr-7");
  });

  it("throws when nothing is available", () => {
    expect(() => derivePreviewId({ branch: "main" })).toThrow(/could not derive/);
    expect(() => derivePreviewId({ branch: "main" }, "pr")).toThrow(
      /requires a pull request number/,
    );
  });

  it("slugs branches", () => {
    expect(branchSlug("refs/heads/Feature/Add Thing!!")).toBe("feature-add-thing");
    expect(branchSlug("123-starts-with-digit")).toBe("starts-with-digit");
    expect(
      branchSlug("a-very-long-branch-name-that-keeps-going-forever").length,
    ).toBeLessThanOrEqual(20);
    expect(derivePreviewId({ branch: "Feature/Thing" }, "branch-slug")).toBe("feature-thing");
  });

  it("validates ids", () => {
    expect(isValidPreviewId("abc-123")).toBe(true);
    expect(isValidPreviewId("pr-42")).toBe(true);
    expect(isValidPreviewId("Abc-123")).toBe(false);
    expect(isValidPreviewId("abc--123")).toBe(false);
    expect(isValidPreviewId("1abc")).toBe(false);
    expect(isValidPreviewId("a".repeat(21))).toBe(false);
  });
});
