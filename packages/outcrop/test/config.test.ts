import { definePlatformConfig } from "../src/config/schema";
import { baseConfigInput } from "./fixtures";

describe("definePlatformConfig", () => {
  it("applies defaults", () => {
    const config = definePlatformConfig(baseConfigInput);
    expect(config.isolation).toBe("account");
    expect(config.ssmRootPrefix).toBe("/platform");
    expect(config.preview).toEqual({
      targetEnvironment: "dev",
      idStrategy: "ticket-then-pr",
      domainPattern: "{service}-{previewId}.{envDomain}",
    });
    expect(config.environments["dev"]?.protected).toBe(false);
    expect(config.environments["dev"]?.logRetentionDays).toBe(90);
    expect(config.tags).toEqual({});
  });

  it("rejects non kebab-case service names", () => {
    expect(() => definePlatformConfig({ ...baseConfigInput, service: "Orders" })).toThrow(
      /kebab-case/,
    );
    expect(() => definePlatformConfig({ ...baseConfigInput, service: "orders-" })).toThrow(
      /kebab-case/,
    );
  });

  it("rejects invalid account ids", () => {
    expect(() =>
      definePlatformConfig({
        ...baseConfigInput,
        environments: { dev: { account: "123", region: "eu-west-1" } },
      }),
    ).toThrow(/12 digit/);
  });

  it("requires the preview target to be a configured, unprotected environment", () => {
    expect(() =>
      definePlatformConfig({ ...baseConfigInput, preview: { targetEnvironment: "staging" } }),
    ).toThrow(/not one of the configured environments/);
    expect(() =>
      definePlatformConfig({ ...baseConfigInput, preview: { targetEnvironment: "prod" } }),
    ).toThrow(/protected/);
  });

  it("requires at least one environment", () => {
    expect(() => definePlatformConfig({ ...baseConfigInput, environments: {} })).toThrow(
      /at least one environment/,
    );
  });

  it("validates the ssm root prefix", () => {
    expect(() => definePlatformConfig({ ...baseConfigInput, ssmRootPrefix: "platform" })).toThrow(
      /absolute SSM path/,
    );
    expect(
      definePlatformConfig({ ...baseConfigInput, ssmRootPrefix: "/acme/platform" }).ssmRootPrefix,
    ).toBe("/acme/platform");
  });
});
