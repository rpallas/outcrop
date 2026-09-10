import { ALERT_SEVERITIES, PlatformParameterPaths, isAlertSeverity } from "../src/paths";

describe("PlatformParameterPaths", () => {
  const paths = new PlatformParameterPaths();

  it("builds account paths", () => {
    expect(paths.account.id()).toBe("/platform/account/id");
    expect(paths.account.kmsKeyArn()).toBe("/platform/account/kms/key-arn");
    expect(paths.account.deployRoleArn("org/repo")).toBe(
      "/platform/account/deploy/role-arn/org/repo",
    );
    expect(paths.account.accessLogsBucketName()).toBe(
      "/platform/account/logging/access-logs-bucket-name",
    );
  });

  it("builds environment paths", () => {
    const env = paths.env("prod");
    expect(env.root()).toBe("/platform/env/prod");
    expect(env.domain()).toBe("/platform/env/prod/domain");
    expect(env.alertTopicArn("high")).toBe("/platform/env/prod/alerts/topic-arn/high");
    expect(env.eventBusName()).toBe("/platform/env/prod/events/bus-name");
    expect(env.certUsEast1Arn()).toBe("/platform/env/prod/certs/us-east-1-arn");
  });

  it("builds config, secret and service paths", () => {
    expect(paths.config("feature-flags")).toBe("/platform/config/feature-flags");
    expect(paths.secretArn("database")).toBe("/platform/secrets/database/arn");
    expect(paths.service("orders", "api-url")).toBe("/platform/services/orders/api-url");
  });

  it("normalises the root prefix and path segments", () => {
    const custom = new PlatformParameterPaths("/acme/platform/");
    expect(custom.root).toBe("/acme/platform");
    expect(custom.config("/key/")).toBe("/acme/platform/config/key");
  });
});

describe("alert severities", () => {
  it("lists the supported severities", () => {
    expect(ALERT_SEVERITIES).toEqual(["critical", "high", "medium", "low"]);
    expect(isAlertSeverity("low")).toBe(true);
    expect(isAlertSeverity("urgent")).toBe(false);
  });
});
