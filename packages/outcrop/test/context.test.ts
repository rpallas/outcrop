import { App, RemovalPolicy } from "aws-cdk-lib";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { resolvePlatformContext, toRetentionDays } from "../src/config/context";
import { testConfig } from "./fixtures";

const resolve = (context: Record<string, unknown>, config = testConfig()) =>
  resolvePlatformContext(new App({ context }), config);

describe("resolvePlatformContext", () => {
  it("resolves a base environment", () => {
    const ctx = resolve({ env: "dev" });
    expect(ctx.env).toBe("dev");
    expect(ctx.isPreview).toBe(false);
    expect(ctx.previewId).toBeUndefined();
    expect(ctx.account).toBe("111111111111");
    expect(ctx.region).toBe("eu-west-1");
    expect(ctx.envDomain).toBe("dev.example.com");
    expect(ctx.removalPolicy).toBe(RemovalPolicy.DESTROY);
    expect(ctx.logRetention).toBe(RetentionDays.THREE_MONTHS);
    expect(ctx.stackSuffix).toBeUndefined();
  });

  it("protected environments retain", () => {
    const ctx = resolve({ env: "prod" });
    expect(ctx.removalPolicy).toBe(RemovalPolicy.RETAIN);
  });

  it("honours an explicit removal policy", () => {
    const config = testConfig({
      environments: { dev: { region: "eu-west-1", removalPolicy: "retain" } },
    });
    expect(resolve({ env: "dev" }, config).removalPolicy).toBe(RemovalPolicy.RETAIN);
  });

  it("resolves a preview and defaults env to the preview target", () => {
    const ctx = resolve({ preview: "true", previewId: "abc-123", prNumber: "42" });
    expect(ctx.env).toBe("dev");
    expect(ctx.isPreview).toBe(true);
    expect(ctx.previewId).toBe("abc-123");
    expect(ctx.prNumber).toBe("42");
    expect(ctx.removalPolicy).toBe(RemovalPolicy.DESTROY);
    expect(ctx.logRetention).toBe(RetentionDays.ONE_WEEK);
  });

  it("requires env", () => {
    expect(() => resolve({})).toThrow(/Missing CDK context "env"/);
  });

  it("rejects unknown environments", () => {
    expect(() => resolve({ env: "qa" })).toThrow(/Unknown environment "qa"/);
  });

  it("requires previewId for previews", () => {
    expect(() => resolve({ env: "dev", preview: true })).toThrow(/require -c previewId/);
  });

  it("rejects invalid preview ids", () => {
    expect(() => resolve({ env: "dev", preview: true, previewId: "Bad_Id" })).toThrow(/invalid/);
  });

  it("refuses previews in protected or non-target environments", () => {
    expect(() => resolve({ env: "prod", preview: true, previewId: "abc-1" })).toThrow(/protected/);
    const config = testConfig({
      environments: {
        dev: { region: "eu-west-1" },
        stage: { region: "eu-west-1" },
      },
    });
    expect(() => resolve({ env: "stage", preview: true, previewId: "abc-1" }, config)).toThrow(
      /must target "dev"/,
    );
  });

  it("adds an env stack suffix for shared isolation", () => {
    expect(resolve({ env: "dev" }, testConfig({ isolation: "shared" })).stackSuffix).toBe("dev");
  });

  it("falls back to CDK_DEFAULT_ACCOUNT", () => {
    const previous = process.env["CDK_DEFAULT_ACCOUNT"];
    process.env["CDK_DEFAULT_ACCOUNT"] = "333333333333";
    try {
      const config = testConfig({ environments: { dev: { region: "eu-west-1" } } });
      expect(resolve({ env: "dev" }, config).account).toBe("333333333333");
    } finally {
      if (previous === undefined) delete process.env["CDK_DEFAULT_ACCOUNT"];
      else process.env["CDK_DEFAULT_ACCOUNT"] = previous;
    }
  });
});

describe("toRetentionDays", () => {
  it("maps exact and rounded values", () => {
    expect(toRetentionDays(7)).toBe(RetentionDays.ONE_WEEK);
    expect(toRetentionDays(10)).toBe(RetentionDays.TWO_WEEKS);
    expect(toRetentionDays(400)).toBe(RetentionDays.THIRTEEN_MONTHS);
    expect(toRetentionDays(500)).toBe(RetentionDays.EIGHTEEN_MONTHS);
    expect(toRetentionDays(100000)).toBe(RetentionDays.INFINITE);
  });
});
