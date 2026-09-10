import { Stack } from "aws-cdk-lib";
import { defineAccountConfig } from "../src/config";
import { resolveAccountEnv } from "../src/context";
import { baseAccountConfig, testAccountConfig, testApp } from "./fixtures";

describe("defineAccountConfig", () => {
  it("applies defaults", () => {
    const config = testAccountConfig();
    expect(config.ssmRootPrefix).toBe("/platform");
    expect(config.cdkQualifier).toBe("hnb659fds");
    expect(config.environments["dev"]?.github[0]?.allowPullRequests).toBe(true);
    expect(config.environments["dev"]?.github[0]?.readOnlyRole).toBe(true);
    expect(config.environments["prod"]?.logRetentionDays).toBe(90);
  });

  it("rejects invalid input", () => {
    expect(() => defineAccountConfig({ project: "x", environments: {} })).toThrow(
      /at least one environment/,
    );
    expect(() =>
      defineAccountConfig({ project: "Bad Name", environments: baseAccountConfig.environments }),
    ).toThrow();
    expect(() =>
      defineAccountConfig({
        project: "ok",
        environments: { dev: { account: "123", region: "eu-west-1" } },
      }),
    ).toThrow(/12 digit/);
    expect(() =>
      defineAccountConfig({
        project: "ok",
        environments: {
          dev: { account: "111111111111", region: "eu-west-1", alertEmails: ["nope"] },
        },
      }),
    ).toThrow();
  });
});

describe("resolveAccountEnv", () => {
  it("reads the env context", () => {
    const app = testApp("prod");
    const context = resolveAccountEnv(new Stack(app, "S"), testAccountConfig());
    expect(context.env).toBe("prod");
    expect(context.environment.protected).toBe(true);
    expect(context.naming.resource("iamRole", "deploy-x")).toBe("platform-prod-deploy-x");
    expect(context.paths.env("prod").domain()).toBe("/platform/env/prod/domain");
  });

  it("fails on missing or unknown env", () => {
    const app = new App();
    expect(() => resolveAccountEnv(new Stack(app, "A"), testAccountConfig())).toThrow(
      /missing environment/,
    );
    expect(() => resolveAccountEnv(new Stack(app, "B"), testAccountConfig(), "staging")).toThrow(
      /unknown environment "staging"/,
    );
  });
});

import { App } from "aws-cdk-lib";
