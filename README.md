# platform-cdk

Lambda-first AWS CDK constructs, an account baseline, Lambda runtime helpers, a scaffolding CLI and reusable GitHub Actions workflows for building services with a full preview-stack development workflow.

Open a pull request and get an isolated, fully deployed copy of your service on its own subdomain. Merge and it is destroyed. Promote through environments with approval gates. Every resource is named, tagged, alarmed and secured by convention.

## Packages

- `@rpallas/platform-cdk` - `PlatformApp`, `PlatformStack`, naming, the SSM contract, alerting, and constructs for Lambda, HTTP API, DynamoDB, SQS, SNS, S3, EventBridge, Step Functions, CloudFront, Cognito, KMS, Secrets Manager, WAF and more.
- `@rpallas/platform-cdk-account` - `AccountBaseline`: GitHub OIDC deploy roles, DNS and certificates, alerting topics, event bus, KMS, shared parameters and secrets, budgets, security services, networking, plus StackSet wrappers for organisation-wide rollout.
- `@rpallas/platform-cdk-runtime` - structured logging, config and secrets resolution, EventBridge envelopes and handler middleware for Lambda code.
- `@rpallas/platform-cdk-cli` - `platform-cdk create service`, `create account`, `preview-id`, `stack-outputs`, `sync-skills`.
- `@rpallas/platform-cdk-neon` - Neon Postgres branch per preview stack.
- `@rpallas/platform-cdk-chatops` - Slack and Microsoft Teams alarm delivery.
- Reusable workflows in `.github/workflows` - `service-checks`, `service-preview-deploy`, `service-preview-destroy`, `service-deploy`, `account-baseline-deploy`.

## Quick start

```bash
npx @rpallas/platform-cdk-cli create service orders --http-api --dynamodb
cd orders
npm ci
npx cdk synth -c env=dev
```

Then add three ~20 line workflows that call the reusable ones and set two repository variables (`AWS_REGION`, `AWS_DEPLOY_ROLE_ARN_DEV`). See `docs/guides/getting-started.md`.

## How it fits together

```text
platform.config.ts  ->  PlatformApp  ->  PlatformStack  ->  Platform* constructs
                                             |                    |
                                     tags, removal policy   names via PlatformNaming
                                             |                    |
                                       PlatformParameters  <-  /platform/... (SSM, written by AccountBaseline)
```

- One typed config file per service describes environments, isolation mode and preview settings.
- Account-level values (hosted zone, certificates, alert topics, event bus, KMS key, VPC) are published to SSM by `AccountBaseline` and read by the constructs. Services never hardcode ARNs.
- Preview stacks are identified by a ticket reference from the branch name (or the PR number), prefixed onto every physical name and given their own `{service}-{previewId}.{envDomain}` hostname.

## Documentation

The documentation site is published from `docs/` with VitePress (`npm run docs:dev` locally) and includes the TypeDoc API reference (`npm run docs:api`).

- `docs/guides/` - getting started, account setup, GitHub setup, new service, testing, workflows
- `docs/constructs/` - one page per construct
- `docs/integrations/` - Neon and chatops
- `docs/conventions/` - naming, SSM contract, preview model, tagging
- `docs/security/` - threat model, SCP compatibility and default IAM review
- `docs/adr/` - architecture decision records
- `docs/roadmap.md`

## Agent skills

`npx @rpallas/platform-cdk-cli sync-skills` copies the bundled skills (`create-platform-service`, `add-platform-construct`, `account-baseline`) into `.agents/skills` so coding agents follow the platform conventions.

## Requirements

- Node.js 22 or later (24 recommended)
- AWS CDK v2 (`aws-cdk-lib ^2.200`)

## Licence

MIT
