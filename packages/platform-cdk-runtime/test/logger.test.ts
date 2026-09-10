import { createLogger, getLogger, resetLogger } from "../src/logger";
import { PLATFORM_VARS, parseLogs, restoreEnv, setEnv, snapshotEnv } from "./helpers";

describe("createLogger", () => {
  beforeEach(() => {
    snapshotEnv();
    setEnv({ ...PLATFORM_VARS, PLATFORM_PREVIEW_ID: "pr-7" });
    resetLogger();
  });

  afterEach(() => {
    restoreEnv();
    resetLogger();
  });

  it("derives service name and persistent keys from the platform environment", () => {
    const spy = jest.spyOn(console, "info").mockImplementation(() => undefined);
    const logger = createLogger();
    logger.info("hello");

    const [record] = parseLogs(spy);
    expect(record).toMatchObject({
      service: "orders",
      env: "dev",
      previewId: "pr-7",
      functionName: "api",
      message: "hello",
    });
    expect(logger.getLevelName()).toBe("DEBUG");
  });

  it("omits previewId and functionName when not set", () => {
    setEnv({ PLATFORM_PREVIEW_ID: undefined, PLATFORM_FUNCTION: undefined });
    const logger = createLogger();
    const keys = logger.getPersistentLogAttributes();
    expect(keys).toEqual({ env: "dev" });
  });

  it("does not throw without PLATFORM_* variables", () => {
    setEnv({ PLATFORM_SERVICE: undefined, PLATFORM_ENV: undefined, PLATFORM_FUNCTION: undefined });
    const logger = createLogger({ serviceName: "fallback", logLevel: "warn" });
    expect(logger.getPersistentLogAttributes()).toEqual({});
    expect(logger.getLevelName()).toBe("WARN");
  });

  it("merges custom persistent keys and prefers explicit options", () => {
    const spy = jest.spyOn(console, "info").mockImplementation(() => undefined);
    const logger = createLogger({
      serviceName: "custom",
      persistentKeys: { tenant: "acme", env: "override" },
    });
    logger.info("hi");
    expect(parseLogs(spy)[0]).toMatchObject({ service: "custom", tenant: "acme", env: "override" });
  });
});

describe("getLogger", () => {
  beforeEach(() => {
    snapshotEnv();
    setEnv(PLATFORM_VARS);
    resetLogger();
  });

  afterEach(() => {
    restoreEnv();
    resetLogger();
  });

  it("returns a singleton until reset", () => {
    const first = getLogger();
    expect(getLogger()).toBe(first);
    resetLogger();
    expect(getLogger()).not.toBe(first);
  });
});
