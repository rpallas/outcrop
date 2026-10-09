import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseCreateAccountArgs, scaffoldAccount } from "../src/commands/create-account";
import { formatScaffold } from "../src/scaffold/format";
import { capture } from "./helpers";

describe("formatScaffold", () => {
  it("formats exactly the files the scaffold wrote", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pcdk-format-"));
    const options = parseCreateAccountArgs(["demo", "--dir", dir], "/");
    if (options === "help") throw new Error("unexpected");
    const formatted: string[] = [];
    const result = scaffoldAccount(options, capture(), {
      npmInstall: () => undefined,
      format: (files) => formatted.push(...files),
    });
    expect(formatted).toEqual(result.written);
  });

  it("warns instead of failing when formatting fails", () => {
    const io = capture();
    formatScaffold(["a.ts"], "/", io, () => {
      throw new Error("prettier not installed");
    });
    expect(io.stderr.join("\n")).toMatch(/could not format.*prettier not installed/);
  });
});
