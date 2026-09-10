import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  dependenciesFor,
  parseCreateServiceArgs,
  scaffoldService,
} from "../src/commands/create-service";
import { renderServiceStack } from "../src/scaffold/service-stack";
import { renderTemplate, toConstantCase, toPascalCase } from "../src/scaffold/template";
import { capture } from "./helpers";

const tmp = (): string => mkdtempSync(path.join(os.tmpdir(), "pcdk-"));
const noInstall = { npmInstall: (): void => undefined };

describe("template renderer", () => {
  it("substitutes variables and blocks", () => {
    const out = renderTemplate("a={{a}}\n{{#if flag}}yes\n{{/if}}{{#unless flag}}no\n{{/unless}}", {
      a: "1",
      flag: true,
    });
    expect(out).toBe("a=1\nyes\n");
    expect(renderTemplate("{{#if flag}}yes{{/if}}-", { flag: false })).toBe("-");
  });

  it("throws on unknown variables", () => {
    expect(() => renderTemplate("{{missing}}", {})).toThrow(/"missing" is not defined/);
  });

  it("leaves GitHub expressions alone", () => {
    expect(renderTemplate("${{ vars.AWS_REGION }} {{x}}", { x: "y" })).toBe(
      "${{ vars.AWS_REGION }} y",
    );
  });

  it("case helpers", () => {
    expect(toPascalCase("hello-http")).toBe("HelloHttp");
    expect(toConstantCase("hello-http")).toBe("HELLO_HTTP");
  });
});

describe("renderServiceStack", () => {
  it("combines variants", () => {
    const code = renderServiceStack({
      service: "orders",
      variants: new Set(["http-api", "queue-consumer", "dynamodb"]),
      auth: "jwt-auth0",
    });
    expect(code).toContain("export class OrdersStack extends PlatformStack");
    expect(code).toContain('new PlatformTable(this, "Table"');
    expect(code).toContain('new PlatformQueue(this, "Jobs"');
    expect(code).toContain("PlatformHttpAuthorizers.auth0(");
    expect(code).toContain("jobs.grantSendMessages(httpHandler);");
    expect(code).toContain(
      'api.addLambdaRoute("/health", HttpMethod.GET, httpHandler, { authorizer: PlatformHttpAuthorizers.none() });',
    );
    expect(code).not.toContain("{{");
  });

  it("renders every variant without placeholders", () => {
    const code = renderServiceStack({
      service: "kitchen",
      variants: new Set([
        "http-api",
        "queue-consumer",
        "event-subscriber",
        "scheduled",
        "static-site",
        "neon",
      ]),
      auth: "api-key",
    });
    expect(code).toContain("NeonBranch");
    expect(code).toContain("PlatformEventRule");
    expect(code).toContain("PlatformSchedule");
    expect(code).toContain("PlatformStaticSite");
    expect(code).toContain("PlatformSecret");
    expect(code).not.toContain("{{");
  });
});

describe("create service", () => {
  it("parses arguments", () => {
    const options = parseCreateServiceArgs(
      ["orders", "--http-api", "--dynamodb", "--auth", "jwt-auth0", "--no-install"],
      "/tmp",
    );
    expect(options).not.toBe("help");
    if (options === "help") return;
    expect([...options.variants]).toEqual(["http-api", "dynamodb"]);
    expect(options.auth).toBe("jwt-auth0");
    expect(options.install).toBe(false);
    expect(options.targetDir).toBe("/tmp/orders");
    expect(dependenciesFor(options).dependencies).toContain("@aws-sdk/lib-dynamodb");
  });

  it("defaults to http-api and validates", () => {
    const options = parseCreateServiceArgs(["orders"], "/tmp");
    expect(options !== "help" && [...options.variants]).toEqual(["http-api"]);
    expect(() => parseCreateServiceArgs(["Orders"], "/tmp")).toThrow(/kebab-case/);
    expect(() => parseCreateServiceArgs(["orders", "--dynamodb", "--neon"], "/tmp")).toThrow(
      /either/,
    );
    expect(() =>
      parseCreateServiceArgs(["orders", "--queue-consumer", "--auth", "api-key"], "/tmp"),
    ).toThrow(/requires --http-api/);
    expect(() => parseCreateServiceArgs(["orders", "--auth", "magic"], "/tmp")).toThrow(
      /unknown --auth/,
    );
    expect(parseCreateServiceArgs(["--help"], "/tmp")).toBe("help");
  });

  it("scaffolds a service directory", () => {
    const dir = tmp();
    const options = parseCreateServiceArgs(
      ["orders", "--http-api", "--dynamodb", "--queue-consumer", "--no-install", "--dir", dir],
      "/",
    );
    if (options === "help") throw new Error("unexpected");
    const result = scaffoldService(options, capture(), noInstall);
    expect(result.skipped).toEqual([]);
    for (const file of [
      "package.json",
      "platform.config.ts",
      "cdk.json",
      ".gitignore",
      ".github/workflows/preview.yml",
      "infra/bin/app.ts",
      "infra/lib/service-stack.ts",
      "infra/tests/service-stack.snapshot.test.ts",
      "app/src/handlers/http.ts",
      "app/src/handlers/consumer.ts",
      "app/src/lib/items-repository.ts",
      "app/tests/unit/http.test.ts",
      "app/tests/integration/api.test.ts",
    ]) {
      expect(existsSync(path.join(dir, file))).toBe(true);
    }
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
      name: string;
      dependencies: Record<string, string>;
    };
    expect(pkg.name).toBe("orders");
    expect(pkg.dependencies["@rpallas/platform-cdk-runtime"]).toBe("latest");
    const config = readFileSync(path.join(dir, "platform.config.ts"), "utf8");
    expect(config).toContain('service: "orders"');
    expect(config).not.toContain("{{");
    const http = readFileSync(path.join(dir, "app/src/handlers/http.ts"), "utf8");
    expect(http).toContain("items-repository");
    expect(http).not.toContain("{{");
  });

  it("skips existing files unless forced", () => {
    const dir = tmp();
    const options = parseCreateServiceArgs(["orders", "--no-install", "--dir", dir], "/");
    if (options === "help") throw new Error("unexpected");
    scaffoldService(options, capture(), noInstall);
    const second = scaffoldService(options, capture(), noInstall);
    expect(second.written).toEqual([]);
    expect(second.skipped.length).toBeGreaterThan(5);
  });
});
