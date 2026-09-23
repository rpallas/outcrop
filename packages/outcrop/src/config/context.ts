import { RemovalPolicy } from "aws-cdk-lib";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import type { IConstruct } from "constructs";
import { assertValidPreviewId } from "./preview-id";
import type { EnvironmentConfig, PlatformConfig } from "./schema";

/** CDK context keys understood by the platform. Pass with `cdk -c key=value`. */
export const PLATFORM_CONTEXT_KEYS = {
  env: "env",
  preview: "preview",
  previewId: "previewId",
  prNumber: "prNumber",
} as const;

export interface PlatformContext {
  /** Validated config the context was derived from. */
  readonly config: PlatformConfig;
  /** Selected environment name. */
  readonly env: string;
  /** Selected environment config. */
  readonly environment: EnvironmentConfig;
  /** True when deploying a preview stack. */
  readonly isPreview: boolean;
  /** Preview id, present only when `isPreview`. */
  readonly previewId: string | undefined;
  /** Pull request number when supplied via context (used for tagging). */
  readonly prNumber: string | undefined;
  /** Account id from config or CDK_DEFAULT_ACCOUNT. May be undefined for env-agnostic synth. */
  readonly account: string | undefined;
  readonly region: string;
  /** Environment domain when configured. */
  readonly envDomain: string | undefined;
  /** Removal policy for stateful resources. */
  readonly removalPolicy: RemovalPolicy;
  /** Log retention for log groups. */
  readonly logRetention: RetentionDays;
  /** Segment appended to stack names: previewId for previews, env for shared isolation. */
  readonly stackSuffix: string | undefined;
}

const parseBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "1", "yes"].includes(value.toLowerCase());
  return false;
};

const asString = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (typeof value === "number") return String(value);
  return undefined;
};

const RETENTION_BY_DAYS: Record<number, RetentionDays> = Object.fromEntries(
  Object.values(RetentionDays)
    .filter((v): v is RetentionDays => typeof v === "number")
    .map((v) => [v, v]),
);

/** Map an arbitrary number of days onto the nearest (not smaller) supported RetentionDays. */
export const toRetentionDays = (days: number): RetentionDays => {
  const exact = RETENTION_BY_DAYS[days];
  if (exact !== undefined) return exact;
  const candidates = Object.keys(RETENTION_BY_DAYS)
    .map(Number)
    .sort((a, b) => a - b);
  const next = candidates.find((c) => c >= days);
  return next !== undefined
    ? (RETENTION_BY_DAYS[next] ?? RetentionDays.INFINITE)
    : RetentionDays.INFINITE;
};

const resolveRemovalPolicy = (
  isPreview: boolean,
  environment: EnvironmentConfig,
): RemovalPolicy => {
  if (isPreview) return RemovalPolicy.DESTROY;
  if (environment.removalPolicy === "retain") return RemovalPolicy.RETAIN;
  if (environment.removalPolicy === "destroy") return RemovalPolicy.DESTROY;
  return environment.protected ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
};

/**
 * Resolve the deployment context from CDK context values and the platform config.
 *
 * - `env` selects the environment (defaults to `preview.targetEnvironment` when `preview=true`).
 * - `preview=true` marks a preview deployment; `previewId` is then required.
 */
export const resolvePlatformContext = (
  scope: IConstruct,
  config: PlatformConfig,
): PlatformContext => {
  const ctx = (key: string): unknown => scope.node.tryGetContext(key);

  const isPreview = parseBoolean(ctx(PLATFORM_CONTEXT_KEYS.preview));
  const env =
    asString(ctx(PLATFORM_CONTEXT_KEYS.env)) ??
    (isPreview ? config.preview.targetEnvironment : undefined);
  if (!env) {
    throw new Error(
      `Missing CDK context "env". Pass -c env=<${Object.keys(config.environments).join("|")}> (or -c preview=true to target ${config.preview.targetEnvironment}).`,
    );
  }
  const environment = config.environments[env];
  if (!environment) {
    throw new Error(
      `Unknown environment "${env}". Configured environments: ${Object.keys(config.environments).join(", ")}`,
    );
  }

  let previewId: string | undefined;
  if (isPreview) {
    const raw = asString(ctx(PLATFORM_CONTEXT_KEYS.previewId));
    if (!raw) {
      throw new Error(
        'Preview deployments require -c previewId=<id> (for example "abc-123" or "pr-42").',
      );
    }
    previewId = assertValidPreviewId(raw);
    if (environment.protected) {
      throw new Error(`Environment "${env}" is protected and cannot host preview stacks.`);
    }
    if (env !== config.preview.targetEnvironment) {
      throw new Error(
        `Preview stacks must target "${config.preview.targetEnvironment}" (preview.targetEnvironment), not "${env}".`,
      );
    }
  }

  const account = environment.account ?? asString(process.env["CDK_DEFAULT_ACCOUNT"]);
  const stackSuffixParts: string[] = [];
  if (config.isolation === "shared") stackSuffixParts.push(env);
  const stackSuffix = stackSuffixParts.length > 0 ? stackSuffixParts.join("-") : undefined;

  return {
    config,
    env,
    environment,
    isPreview,
    previewId,
    prNumber: asString(ctx(PLATFORM_CONTEXT_KEYS.prNumber)),
    account,
    region: environment.region,
    envDomain: environment.domain,
    removalPolicy: resolveRemovalPolicy(isPreview, environment),
    logRetention: isPreview
      ? RetentionDays.ONE_WEEK
      : toRetentionDays(environment.logRetentionDays),
    stackSuffix,
  };
};
