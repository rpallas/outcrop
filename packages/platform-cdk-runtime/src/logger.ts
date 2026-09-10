import { Logger } from "@aws-lambda-powertools/logger";
import type { LogLevel } from "@aws-lambda-powertools/logger/types";
import { tryPlatformEnv } from "./env";

export type { Logger, LogLevel };

export interface CreateLoggerOptions {
  /** Service name; defaults to `POWERTOOLS_SERVICE_NAME`, then `PLATFORM_SERVICE`. */
  serviceName?: string;
  /** Log level; defaults to `LOG_LEVEL` / `POWERTOOLS_LOG_LEVEL`, then `info`. */
  logLevel?: LogLevel;
  /** Additional keys added to every log record. */
  persistentKeys?: Record<string, unknown>;
  /** Debug sampling rate between 0 and 1. */
  sampleRateValue?: number;
}

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : value;

/**
 * Creates a Powertools {@link Logger} pre-configured for the platform.
 *
 * Persistent keys `env`, `previewId` and `functionName` are derived from the
 * `PLATFORM_*` environment variables when they are available. Missing variables
 * never cause an error so the logger keeps working in local scripts and tests.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const platform = tryPlatformEnv();

  const serviceName =
    options.serviceName ??
    nonEmpty(process.env["POWERTOOLS_SERVICE_NAME"]) ??
    platform?.service ??
    nonEmpty(process.env["PLATFORM_SERVICE"]);

  const logLevel: LogLevel | undefined =
    options.logLevel ??
    (nonEmpty(process.env["POWERTOOLS_LOG_LEVEL"]) === undefined ? platform?.logLevel : undefined);

  const persistentKeys: Record<string, unknown> = {};
  if (platform) {
    persistentKeys["env"] = platform.env;
    if (platform.previewId !== undefined) persistentKeys["previewId"] = platform.previewId;
    if (platform.functionName !== undefined) persistentKeys["functionName"] = platform.functionName;
  } else {
    const env = nonEmpty(process.env["PLATFORM_ENV"]);
    if (env !== undefined) persistentKeys["env"] = env;
  }
  Object.assign(persistentKeys, options.persistentKeys);

  const logger = new Logger({
    ...(serviceName !== undefined ? { serviceName } : {}),
    ...(logLevel !== undefined ? { logLevel } : {}),
    ...(options.sampleRateValue !== undefined ? { sampleRateValue: options.sampleRateValue } : {}),
  });
  if (Object.keys(persistentKeys).length > 0) {
    logger.appendPersistentKeys(persistentKeys);
  }
  return logger;
}

let singleton: Logger | undefined;

/** Returns the module-level logger, creating it on first use. */
export function getLogger(): Logger {
  singleton ??= createLogger();
  return singleton;
}

/** Drops the module-level logger so the next {@link getLogger} call creates a fresh one. */
export function resetLogger(): void {
  singleton = undefined;
}
