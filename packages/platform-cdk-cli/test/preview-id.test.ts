import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { previewIdCommand } from "../src/commands/preview-id";
import { main } from "../src/index";
import { derivePreviewId, ticketFromBranch } from "../src/preview-id";
import { capture } from "./helpers";

describe("preview-id", () => {
  it("derives ids like the core library", () => {
    expect(ticketFromBranch("feature/ABC-123-thing")).toBe("abc-123");
    expect(derivePreviewId({ branch: "fix", prNumber: 42 })).toBe("pr-42");
    expect(derivePreviewId({ branch: "Feature/Thing" }, "branch-slug")).toBe("feature-thing");
    expect(() => derivePreviewId({ branch: "main" })).toThrow(/could not derive/);
  });

  it("prints the id from flags", () => {
    const io = capture();
    expect(previewIdCommand(["--branch", "feature/abc-123", "--pr", "1"], io)).toBe(0);
    expect(io.stdout).toEqual(["abc-123"]);
  });

  it("reads GitHub Actions environment", () => {
    const io = capture({ GITHUB_HEAD_REF: "no-ticket-here", GITHUB_REF: "refs/pull/77/merge" });
    previewIdCommand([], io);
    expect(io.stdout).toEqual(["pr-77"]);
  });

  it("writes to GITHUB_OUTPUT", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pcdk-"));
    const file = path.join(dir, "output");
    const io = capture({ GITHUB_OUTPUT: file });
    previewIdCommand(["--branch", "abc-1", "--github-output", "id"], io);
    expect(readFileSync(file, "utf8")).toBe("id=abc-1\n");
  });

  it("rejects unknown strategies", async () => {
    const io = capture();
    expect(await main(["preview-id", "--branch", "x", "--strategy", "nope"], io)).toBe(1);
    expect(io.stderr[0]).toMatch(/unknown strategy/);
  });

  it("shows help", async () => {
    const io = capture();
    expect(await main(["preview-id", "--help"], io)).toBe(0);
    expect(io.stdout[0]).toMatch(/Usage: platform-cdk preview-id/);
    expect(await main([], io)).toBe(0);
    expect(await main(["bogus"], io)).toBe(1);
  });
});
