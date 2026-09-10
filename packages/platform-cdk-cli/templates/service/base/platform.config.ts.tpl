import { definePlatformConfig } from "@rpallas/platform-cdk";

/**
 * Platform configuration for the {{service}} service.
 *
 * - `environments` lists every AWS environment the service deploys to. The
 *   account baseline (@rpallas/platform-cdk-account) must be applied there.
 * - `preview.targetEnvironment` hosts pull request preview stacks.
 * - Set `account` per environment to enable synth-time lookups (hosted zone,
 *   certificates) without relying on CDK_DEFAULT_ACCOUNT.
 */
export default definePlatformConfig({
  project: "{{project}}",
  service: "{{service}}",
  isolation: "account",
  environments: {
    dev: { region: "{{region}}", domain: "dev.{{domain}}" },
    prod: { region: "{{region}}", domain: "{{domain}}", protected: true },
  },
  preview: {
    targetEnvironment: "dev",
    idStrategy: "ticket-then-pr",
  },
  github: { owner: "{{owner}}", repo: "{{repo}}" },
});
