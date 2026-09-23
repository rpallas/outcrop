import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseCreateServiceArgs, scaffoldService } from "../src/commands/create-service";
import { capture } from "./helpers";

/**
 * examples/hello-http is the golden output of `create service hello-http --http-api --dynamodb`.
 * Only the per-repository tooling files differ (they are replaced by the monorepo's shared config),
 * so everything under these paths must match exactly after formatting.
 */
const COMPARED = [
  "platform.config.ts",
  "cdk.json",
  "infra/bin",
  "infra/lib",
  "infra/tests/service-stack.snapshot.test.ts",
  "app",
  "docs",
];

const exampleDir = path.resolve(__dirname, "..", "..", "..", "examples", "hello-http");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const repoRoot = path.resolve(exampleDir, "..", "..");

/** Format the generated tree with the repository's prettier config (prettier 3 cannot be imported under ts-jest CJS). */
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

describe("examples/hello-http is the scaffolder's golden output", () => {
  it("matches the generated files", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pcdk-golden-"));
    const options = parseCreateServiceArgs(
      [
        "hello-http",
        "--http-api",
        "--dynamodb",
        "--project",
        "Example Platform",
        "--owner",
        "example-org",
        "--no-install",
        "--dir",
        dir,
      ],
      "/",
    );
    if (options === "help") throw new Error("unexpected");
    scaffoldService(options, capture(), { npmInstall: () => undefined });
    formatDir(dir);

    const generated = COMPARED.flatMap((rel) => {
      const full = path.join(dir, rel);
      return statSync(full).isDirectory() ? walk(full) : [full];
    }).map((file) => path.relative(dir, file));
    expect(generated.length).toBeGreaterThan(5);

    for (const rel of generated) {
      const expectedFile = path.join(exampleDir, rel);
      expect(existsSync(expectedFile)).toBe(true);
      const actual = readFileSync(path.join(dir, rel), "utf8");
      const expected = readFileSync(expectedFile, "utf8");
      if (actual !== expected) {
        throw new Error(
          `${rel} differs from examples/hello-http. Regenerate the example or update the template.\n--- generated\n${actual}\n--- example\n${expected}`,
        );
      }
    }
  });
});
