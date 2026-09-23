import { definePlatformConfig } from "@rpallas/outcrop";

/**
 * Platform configuration for the hello-http service.
 *
 * - `environments` lists every AWS environment the service deploys to. The
 *   account baseline (@rpallas/outcrop-account) must be applied there.
 * - `preview.targetEnvironment` hosts pull request preview stacks.
 * - Set `account` per environment to enable synth-time lookups (hosted zone,
 *   certificates) without relying on CDK_DEFAULT_ACCOUNT.
 */
export default definePlatformConfig({
  project: "Example Platform",
  service: "hello-http",
  isolation: "account",
  environments: {
    dev: { region: "eu-west-1", domain: "dev.example.com" },
    prod: { region: "eu-west-1", domain: "example.com", protected: true },
  },
  preview: {
    targetEnvironment: "dev",
    idStrategy: "ticket-then-pr",
  },
  github: { owner: "example-org", repo: "hello-http" },
});
