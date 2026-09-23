import { platformEnv, requireEnv, tryPlatformEnv } from "../src/env";

describe("platformEnv", () => {
  it("reads the platform variables with defaults", () => {
    const env = platformEnv({
      PLATFORM_SERVICE: "orders",
      PLATFORM_ENV: "dev",
    });
    expect(env).toEqual({
      project: "orders",
      service: "orders",
      env: "dev",
      ssmRoot: "/platform",
      logLevel: "info",
      isPreview: false,
    });
  });

  it("reads optional values and flags previews", () => {
    const env = platformEnv({
      PLATFORM_PROJECT: "shop",
      PLATFORM_SERVICE: "orders",
      PLATFORM_ENV: "dev",
      PLATFORM_PREVIEW_ID: "pr-12",
      PLATFORM_SSM_ROOT: "/acme/",
      PLATFORM_FUNCTION: "api",
      LOG_LEVEL: "DEBUG",
    });
    expect(env).toEqual({
      project: "shop",
      service: "orders",
      env: "dev",
      previewId: "pr-12",
      ssmRoot: "/acme/",
      functionName: "api",
      logLevel: "debug",
      isPreview: true,
    });
  });

  it("names the missing variable", () => {
    expect(() => platformEnv({ PLATFORM_ENV: "dev" })).toThrow(/PLATFORM_SERVICE/);
    expect(() => platformEnv({ PLATFORM_SERVICE: "orders" })).toThrow(/PLATFORM_ENV/);
  });

  it("rejects unknown log levels", () => {
    expect(() =>
      platformEnv({ PLATFORM_SERVICE: "orders", PLATFORM_ENV: "dev", LOG_LEVEL: "loud" }),
    ).toThrow(/Invalid LOG_LEVEL "loud"/);
  });

  it("tryPlatformEnv returns undefined instead of throwing", () => {
    expect(tryPlatformEnv({})).toBeUndefined();
    expect(tryPlatformEnv({ PLATFORM_SERVICE: "a", PLATFORM_ENV: "b" })?.env).toBe("b");
  });
});

describe("requireEnv", () => {
  it("returns the value or throws with the variable name", () => {
    expect(requireEnv("X", { X: "1" })).toBe("1");
    expect(() => requireEnv("MISSING_VAR", {})).toThrow(
      "Missing required environment variable MISSING_VAR",
    );
    expect(() => requireEnv("EMPTY", { EMPTY: "" })).toThrow(/EMPTY/);
  });
});
