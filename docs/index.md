---
layout: home
hero:
  name: platform-cdk
  text: Lambda-first AWS CDK constructs with preview stacks per pull request
  tagline: Opinionated constructs, an account baseline, runtime helpers, a CLI and reusable GitHub Actions workflows. Open source, MIT licensed.
  actions:
    - theme: brand
      text: Get started
      link: /guides/getting-started
    - theme: alt
      text: Constructs
      link: /constructs/
    - theme: alt
      text: GitHub
      link: https://github.com/rpallas/platform-cdk
features:
  - title: Preview stack per pull request
    details: Every PR deploys an isolated copy of the service under its own hostname and is destroyed on close. Ticket id or PR number becomes the preview id.
  - title: Account baseline
    details: GitHub OIDC deploy roles, DNS and certificates, alert topics, event bus, KMS, budgets, security services and shared configuration published under /platform in SSM.
  - title: Sensible defaults
    details: Every construct ships with naming, encryption, retention, removal policies, alarms and dashboards wired to the environment. cdk-nag clean out of the box.
  - title: Runtime helpers
    details: A small runtime package with structured logging, config and secrets access, an event envelope and handler wrappers for HTTP, SQS and EventBridge.
  - title: Reusable workflows
    details: Checks, preview deploy and destroy, promotion through dev, stage and prod, and account baseline deploys as workflow_call workflows pinned to a floating v1 tag.
  - title: CLI and agent skills
    details: npx @rpallas/platform-cdk-cli create service scaffolds infra, handlers, tests, workflows and docs. Bundled skills teach coding agents the conventions.
---

## Packages

| Package                         | Purpose                                                                     |
| ------------------------------- | --------------------------------------------------------------------------- |
| `@rpallas/platform-cdk`         | Constructs, naming, SSM contract, alarms, `PlatformApp` and `PlatformStack` |
| `@rpallas/platform-cdk-account` | Account baseline modules, `createAccountBaseline`, StackSets                |
| `@rpallas/platform-cdk-runtime` | Lambda runtime helpers and the Powertools layer                             |
| `@rpallas/platform-cdk-cli`     | `create service`, `create account`, `preview-id`, `stack-outputs`, skills   |
| `@rpallas/platform-cdk-neon`    | Neon Postgres branch per preview                                            |
| `@rpallas/platform-cdk-chatops` | Alarm notifications to Slack and Microsoft Teams                            |

```sh
npx @rpallas/platform-cdk-cli create service orders --http-api --dynamodb
```
