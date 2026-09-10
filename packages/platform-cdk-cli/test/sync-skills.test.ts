import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncSkillsCommand } from "../src/commands/sync-skills";
import { parseCreateServiceArgs, scaffoldService } from "../src/commands/create-service";
import { capture } from "./helpers";

describe("sync-skills", () => {
  it("copies the bundled skills into the target directory", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pcdk-skills-"));
    const io = capture();
    expect(syncSkillsCommand(["--dir", dir], io)).toBe(0);
    for (const skill of ["create-platform-service", "add-platform-construct", "account-baseline"]) {
      const file = path.join(dir, skill, "SKILL.md");
      expect(existsSync(file)).toBe(true);
      const content = readFileSync(file, "utf8");
      expect(content.startsWith("---\nname: " + skill)).toBe(true);
      expect(content).toMatch(/\ndescription: .+/);
    }
    expect(io.stdout.at(-1)).toMatch(/3 skill file\(s\) synced/);
  });
});

describe("full variant matrix", () => {
  it("scaffolds every variant and auth mode together without placeholders", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pcdk-matrix-"));
    const options = parseCreateServiceArgs(
      [
        "kitchen",
        "--http-api",
        "--queue-consumer",
        "--event-subscriber",
        "--scheduled",
        "--static-site",
        "--neon",
        "--auth",
        "api-key",
        "--no-install",
        "--dir",
        dir,
      ],
      "/",
    );
    if (options === "help") throw new Error("unexpected");
    const result = scaffoldService(options, capture(), { npmInstall: () => undefined });
    const files = result.written.map((f) => path.relative(dir, f));
    for (const expected of [
      "app/src/handlers/http.ts",
      "app/src/handlers/consumer.ts",
      "app/src/handlers/subscriber.ts",
      "app/src/handlers/scheduled.ts",
      "app/src/handlers/authorizer.ts",
      "app/src/lib/database.ts",
      "app/tests/unit/authorizer.test.ts",
      "app/tests/unit/subscriber.test.ts",
      "app/tests/unit/scheduled.test.ts",
      "web/dist/index.html",
      "infra/lib/service-stack.ts",
    ]) {
      expect(files).toContain(expected);
    }
    for (const file of result.written) {
      const content = readFileSync(file, "utf8");
      expect(content).not.toMatch(/\{\{[#/]?[a-zA-Z]/);
    }
    const stack = readFileSync(path.join(dir, "infra/lib/service-stack.ts"), "utf8");
    expect(stack).toContain('import { NeonBranch } from "@rpallas/platform-cdk-neon";');
    expect(stack).toContain("PlatformHttpAuthorizers.lambda(authorizerFn)");
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies).toHaveProperty("@aws-sdk/client-secrets-manager");
    expect(pkg.devDependencies).toHaveProperty("@rpallas/platform-cdk-neon");
  });
});
