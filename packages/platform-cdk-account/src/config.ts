import { z } from "zod";

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const ACCOUNT_ID = /^\d{12}$/;

/** A GitHub repository allowed to deploy into an environment. */
export const GitHubRepositorySchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  /** Allow `pull_request` workflows (preview stacks) to assume the deploy role. Default true. */
  allowPullRequests: z.boolean().default(true),
  /** Additional branches (besides GitHub environments) allowed to assume the deploy role. */
  branches: z.array(z.string().min(1)).default([]),
  /** GitHub environment names that map to this AWS environment. Defaults to the AWS environment name. */
  githubEnvironments: z.array(z.string().min(1)).optional(),
  /** Also create a read-only role for `cdk diff` on pull requests. Default true. */
  readOnlyRole: z.boolean().default(true),
});
export type GitHubRepository = z.output<typeof GitHubRepositorySchema>;
export type GitHubRepositoryInput = z.input<typeof GitHubRepositorySchema>;

/** Delegate the environment domain from a parent hosted zone (same or another account). */
export const ParentZoneSchema = z.object({
  /** Hosted zone id of the parent zone. */
  hostedZoneId: z.string().min(1),
  /** Zone name of the parent, e.g. `example.com`. */
  zoneName: z.string().min(1),
  /** Role to assume when the parent zone lives in another account. */
  delegationRoleArn: z.string().min(1).optional(),
});
export type ParentZone = z.output<typeof ParentZoneSchema>;

export const AccountEnvironmentSchema = z.object({
  account: z.string().regex(ACCOUNT_ID, "account must be a 12 digit AWS account id"),
  region: z.string().min(1),
  /** Environment apex domain, e.g. `dev.example.com`. Enables the DNS module. */
  domain: z.string().min(1).optional(),
  /** Delegate `domain` from this parent zone instead of expecting NS records to be created by hand. */
  parentZone: ParentZoneSchema.optional(),
  /** Protected environments keep resources on stack deletion and never host previews. */
  protected: z.boolean().default(false),
  /** Default CloudWatch Logs retention for the account. */
  logRetentionDays: z.number().int().positive().default(90),
  /** Repositories allowed to deploy into this environment. */
  github: z.array(GitHubRepositorySchema).default([]),
  /** Email addresses subscribed to the alert topics. */
  alertEmails: z.array(z.email()).default([]),
  /** Monthly budget in USD; enables the budgets module when set. */
  monthlyBudgetUsd: z.number().positive().optional(),
});
export type AccountEnvironment = z.output<typeof AccountEnvironmentSchema>;

export const AccountConfigSchema = z.object({
  /** Project name used for tags and naming. */
  project: z.string().regex(KEBAB_CASE, "project must be kebab-case"),
  /** Root of the SSM parameter contract. */
  ssmRootPrefix: z
    .string()
    .regex(/^\/[a-z0-9/-]*[a-z0-9]$/, "ssmRootPrefix must be an SSM path")
    .default("/platform"),
  /** CDK bootstrap qualifier the deploy roles may assume. */
  cdkQualifier: z
    .string()
    .regex(/^[a-z0-9]{1,10}$/, "qualifier must be 1-10 lowercase alphanumerics")
    .default("hnb659fds"),
  environments: z.record(z.string().regex(KEBAB_CASE), AccountEnvironmentSchema),
  /** Additional tags applied to every resource. */
  tags: z.record(z.string(), z.string()).default({}),
});
export type AccountConfig = z.output<typeof AccountConfigSchema>;
export type AccountConfigInput = z.input<typeof AccountConfigSchema>;

/**
 * Validates and normalises an account baseline configuration.
 *
 * ```ts
 * export default defineAccountConfig({
 *   project: "my-platform",
 *   environments: {
 *     dev: { account: "111111111111", region: "eu-west-1", domain: "dev.example.com",
 *            github: [{ owner: "my-org", repo: "orders" }] },
 *     prod: { account: "222222222222", region: "eu-west-1", domain: "example.com", protected: true,
 *             github: [{ owner: "my-org", repo: "orders", allowPullRequests: false }] },
 *   },
 * });
 * ```
 */
export const defineAccountConfig = (input: AccountConfigInput): AccountConfig => {
  const config = AccountConfigSchema.parse(input);
  if (Object.keys(config.environments).length === 0) {
    throw new Error("account config must define at least one environment");
  }
  return config;
};
