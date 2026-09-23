import { PlatformNaming, PlatformParameterPaths } from "@rpallas/outcrop";
import type { Construct } from "constructs";
import type { AccountConfig, AccountEnvironment } from "./config";

/** Resolved environment the baseline is being synthesised for. */
export interface AccountEnvContext {
  readonly env: string;
  readonly environment: AccountEnvironment;
  readonly config: AccountConfig;
  readonly paths: PlatformParameterPaths;
  /** Naming helper producing `platform-<env>-<name>` for baseline resources. */
  readonly naming: PlatformNaming;
}

/**
 * Reads `-c env=<name>` (or `PLATFORM_ENV`) and returns the matching environment.
 * Baseline stacks are account-level, so there is no preview mode.
 */
export const resolveAccountEnv = (
  scope: Construct,
  config: AccountConfig,
  explicitEnv?: string,
): AccountEnvContext => {
  const contextEnv = scope.node.tryGetContext("env") as unknown;
  const env =
    explicitEnv ??
    (typeof contextEnv === "string" ? contextEnv : undefined) ??
    process.env["PLATFORM_ENV"];
  if (!env) {
    throw new Error(
      `missing environment: pass -c env=<name>; known environments: ${Object.keys(config.environments).join(", ")}`,
    );
  }
  const environment = config.environments[env];
  if (!environment) {
    throw new Error(
      `unknown environment "${env}"; known environments: ${Object.keys(config.environments).join(", ")}`,
    );
  }
  return {
    env,
    environment,
    config,
    paths: new PlatformParameterPaths(config.ssmRootPrefix),
    // Account isolation with `platform-<env>` as the service yields `platform-dev-<name>`.
    naming: new PlatformNaming({
      service: `platform-${env}`,
      env,
      isolation: "account",
      envDomain: environment.domain,
    }),
  };
};
