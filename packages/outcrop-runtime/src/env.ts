/**
 * Platform environment variables injected into every Lambda function by the
 * `@rpallas/outcrop` constructs.
 */
export interface PlatformEnv {
  /** Project name (`PLATFORM_PROJECT`, defaults to the service name). */
  project: string;
  /** Service name (`PLATFORM_SERVICE`). */
  service: string;
  /** Deployment environment such as `dev`, `staging`, `prod` (`PLATFORM_ENV`). */
  env: string;
  /** Preview identifier when running inside a preview stack (`PLATFORM_PREVIEW_ID`). */
  previewId?: string;
  /** SSM root prefix of the platform contract (`PLATFORM_SSM_ROOT`, default `/platform`). */
  ssmRoot: string;
  /** Logical function name within the service (`PLATFORM_FUNCTION`). */
  functionName?: string;
  /** Log level (`LOG_LEVEL`, default `info`). */
  logLevel: PlatformLogLevel;
  /** True when `previewId` is set. */
  isPreview: boolean;
}

export type PlatformLogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: readonly PlatformLogLevel[] = ["debug", "info", "warn", "error"];

export const DEFAULT_SSM_ROOT = "/platform";

/**
 * Reads an environment variable and throws a descriptive error when it is
 * missing or empty.
 */
export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

const optionalEnv = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = env[name];
  return value === undefined || value === "" ? undefined : value;
};

const parseLogLevel = (value: string | undefined): PlatformLogLevel => {
  if (value === undefined || value === "") return "info";
  const lower = value.toLowerCase();
  const match = LOG_LEVELS.find((level) => level === lower);
  if (!match) {
    throw new Error(
      `Invalid LOG_LEVEL "${value}"; expected one of ${LOG_LEVELS.map((l) => `"${l}"`).join(", ")}`,
    );
  }
  return match;
};

/**
 * Resolves the {@link PlatformEnv} from the process environment.
 *
 * Throws when `PLATFORM_SERVICE` or `PLATFORM_ENV` are missing.
 */
export function platformEnv(env: NodeJS.ProcessEnv = process.env): PlatformEnv {
  const service = requireEnv("PLATFORM_SERVICE", env);
  const envName = requireEnv("PLATFORM_ENV", env);
  const previewId = optionalEnv(env, "PLATFORM_PREVIEW_ID");
  const functionName = optionalEnv(env, "PLATFORM_FUNCTION");

  const result: PlatformEnv = {
    project: optionalEnv(env, "PLATFORM_PROJECT") ?? service,
    service,
    env: envName,
    ssmRoot: optionalEnv(env, "PLATFORM_SSM_ROOT") ?? DEFAULT_SSM_ROOT,
    logLevel: parseLogLevel(env["LOG_LEVEL"]),
    isPreview: previewId !== undefined,
  };
  if (previewId !== undefined) result.previewId = previewId;
  if (functionName !== undefined) result.functionName = functionName;
  return result;
}

/**
 * Like {@link platformEnv} but returns `undefined` instead of throwing when the
 * required variables are not present. Useful for helpers that must keep working
 * outside of a platform-managed Lambda (e.g. local scripts and tests).
 */
export function tryPlatformEnv(env: NodeJS.ProcessEnv = process.env): PlatformEnv | undefined {
  try {
    return platformEnv(env);
  } catch {
    return undefined;
  }
}
