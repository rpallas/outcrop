import { z } from "zod";

/** Lowercase kebab-case identifier used for services and names. */
export const KEBAB_CASE = /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/;

export const EnvironmentConfigSchema = z.object({
  /** AWS account id. Optional: falls back to CDK_DEFAULT_ACCOUNT at synth time. */
  account: z
    .string()
    .regex(/^\d{12}$/, "account must be a 12 digit AWS account id")
    .optional(),
  /** Home region for the environment. */
  region: z.string().min(1),
  /** Environment domain, e.g. dev.example.com. Enables custom domains. */
  domain: z.string().min(1).optional(),
  /** Protected environments refuse preview deployments and default to RETAIN removal policies. */
  protected: z.boolean().default(false),
  /** Removal policy for stateful resources. Defaults to retain when protected, destroy otherwise. */
  removalPolicy: z.enum(["destroy", "retain"]).optional(),
  /** CloudWatch log retention in days for this environment (preview stacks always use 7). */
  logRetentionDays: z.number().int().positive().default(90),
});

export const PreviewConfigSchema = z.object({
  /** Environment that hosts preview stacks. */
  targetEnvironment: z.string().min(1).default("dev"),
  /** How the preview id is derived from the pull request. */
  idStrategy: z.enum(["ticket-then-pr", "pr", "branch-slug"]).default("ticket-then-pr"),
  /**
   * Hostname pattern for previews. Tokens: {service}, {previewId}, {envDomain}, {env}.
   * Keep it to a single label below envDomain so the wildcard certificate covers it.
   */
  domainPattern: z.string().default("{service}-{previewId}.{envDomain}"),
});

export const GitHubConfigSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

export const PlatformConfigSchema = z.object({
  /** Human readable product or platform name; used for the platform:project tag. */
  project: z.string().min(1),
  /** Service identifier used in every physical name. */
  service: z.string().regex(KEBAB_CASE, "service must be lowercase kebab-case"),
  /**
   * account: one environment per AWS account, names are not env-prefixed.
   * shared: several environments share an account, names carry the env.
   */
  isolation: z.enum(["account", "shared"]).default("account"),
  /** Root of the SSM parameter contract written by the account baseline. */
  ssmRootPrefix: z
    .string()
    .regex(/^\/[a-zA-Z0-9_.-]+(\/[a-zA-Z0-9_.-]+)*$/, "ssmRootPrefix must be an absolute SSM path")
    .default("/platform"),
  environments: z
    .record(
      z.string().regex(KEBAB_CASE, "environment names must be kebab-case"),
      EnvironmentConfigSchema,
    )
    .refine((envs) => Object.keys(envs).length > 0, "at least one environment is required"),
  preview: PreviewConfigSchema.prefault({}),
  /** Extra tags applied to every resource. */
  tags: z.record(z.string(), z.string()).default({}),
  /** Source repository; used for deploy-role naming and preview tags. */
  github: GitHubConfigSchema.optional(),
});

export type EnvironmentConfig = z.output<typeof EnvironmentConfigSchema>;
export type PreviewConfig = z.output<typeof PreviewConfigSchema>;
export type GitHubConfig = z.output<typeof GitHubConfigSchema>;
export type PlatformConfigInput = z.input<typeof PlatformConfigSchema>;
export type PlatformConfig = z.output<typeof PlatformConfigSchema>;

/**
 * Validate and normalise a platform config. Call this from `platform.config.ts`
 * and pass the result to `PlatformApp`.
 */
export const definePlatformConfig = (config: PlatformConfigInput): PlatformConfig => {
  const parsed = PlatformConfigSchema.parse(config);
  if (!(parsed.preview.targetEnvironment in parsed.environments)) {
    throw new Error(
      `preview.targetEnvironment "${parsed.preview.targetEnvironment}" is not one of the configured environments (${Object.keys(parsed.environments).join(", ")})`,
    );
  }
  const target = parsed.environments[parsed.preview.targetEnvironment];
  if (target?.protected) {
    throw new Error(
      `preview.targetEnvironment "${parsed.preview.targetEnvironment}" must not be a protected environment`,
    );
  }
  return parsed;
};
