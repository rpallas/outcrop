import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseCreateAccountArgs, scaffoldAccount } from "../src/commands/create-account";
import { capture } from "./helpers";

/** examples/account-baseline is the golden output of `create account example-platform ...`. */
const COMPARED = ["account.config.ts", "cdk.json", "bin", "lib", "test/baseline.test.ts"];

const exampleDir = path.resolve(__dirname, "..", "..", "..", "examples", "account-baseline");
const repoRoot = path.resolve(exampleDir, "..", "..");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const formatDir = (dir: string): void => {
  const bin = path.join(repoRoot, "node_modules", "prettier", "bin", "prettier.cjs");
  execFileSync(
    process.execPath,
    [
      bin,
      "--config",
      path.join(repoRoot, ".prettierrc.json"),
      "--log-level",
      "warn",
      "--write",
      ".",
    ],
    {
      cwd: dir,
      stdio: "inherit",
    },
  );
};

describe("examples/account-baseline is the scaffolder's golden output", () => {
  it("matches the generated files", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pcdk-golden-account-"));
    const options = parseCreateAccountArgs(
      [
        "example-platform",
        "--project",
        "example-platform",
        "--owner",
        "example-org",
        "--domain",
        "example.com",
        "--no-install",
        "--dir",
        dir,
      ],
      "/",
    );
    if (options === "help") throw new Error("unexpected");
    scaffoldAccount(options, capture(), { npmInstall: () => undefined });
    formatDir(dir);

    const generated = COMPARED.flatMap((rel) => {
      const full = path.join(dir, rel);
      return statSync(full).isDirectory() ? walk(full) : [full];
    }).map((file) => path.relative(dir, file));
    expect(generated.length).toBeGreaterThan(3);

    for (const rel of generated) {
      const expectedFile = path.join(exampleDir, rel);
      expect(existsSync(expectedFile)).toBe(true);
      const actual = readFileSync(path.join(dir, rel), "utf8");
      const expected = readFileSync(expectedFile, "utf8");
      if (actual !== expected) {
        throw new Error(
          `${rel} differs from examples/account-baseline. Regenerate the example or update the template.\n--- generated\n${actual}\n--- example\n${expected}`,
        );
      }
    }
    // Files that every generated repo needs but the monorepo example replaces with shared config.
    for (const rel of [
      "package.json",
      "tsconfig.json",
      "jest.config.js",
      ".github/workflows/deploy.yml",
      ".gitignore",
      "README.md",
    ]) {
      expect(existsSync(path.join(dir, rel))).toBe(true);
    }
  });
});
