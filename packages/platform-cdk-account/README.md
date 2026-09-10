# @rpallas/platform-cdk-account

Account and environment baseline for [platform-cdk](../../README.md). It provisions what every
service built with `@rpallas/platform-cdk` expects to find in an AWS account and publishes it to
the SSM contract (`/platform/...`, see [ADR 0003](../../docs/adr/0003-ssm-contract.md)).

```sh
npx @rpallas/platform-cdk-cli create account my-platform --owner my-org --domain example.com
```

```ts
// bin/app.ts
import { App } from "aws-cdk-lib";
import { createAccountBaseline, defineAccountConfig } from "@rpallas/platform-cdk-account";

const config = defineAccountConfig({
  project: "my-platform",
  environments: {
    dev: {
      account: "111111111111",
      region: "eu-west-1",
      domain: "dev.example.com",
      alertEmails: ["platform-alerts@example.com"],
      monthlyBudgetUsd: 200,
      github: [{ owner: "my-org", repo: "orders" }],
    },
    prod: {
      account: "222222222222",
      region: "eu-west-1",
      domain: "example.com",
      protected: true,
      github: [{ owner: "my-org", repo: "orders", allowPullRequests: false }],
    },
  },
});

createAccountBaseline(new App(), {
  config,
  modules: {
    githubOidc: true,
    accountSettings: true,
    dns: true,
    alerting: true,
    eventBus: true,
    encryption: true,
    sharedParameters: { values: { "auth0-domain": "example.eu.auth0.com" } },
    sharedSecrets: { secrets: { "neon-api-key": {} } },
    budgets: true,
    security: true,
    logRetention: true,
  },
});
```

`cdk deploy --all -c env=dev` creates `PlatformAccount-dev` in the dev account and, when DNS is
on outside `us-east-1`, `PlatformAccountEdge-dev` holding the CloudFront certificate.

## Modules

Every module is a standalone construct taking `{ context, ...options }`; `AccountBaseline`
composes them and wires the KMS key, topics and parameters together.

| Module                               | Creates                                                                                         | Publishes                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `GitHubOidc`                         | OIDC provider, deploy + read-only role per repository, trust on `sub` claims (ADR 0005)         | `account/deploy/oidc-provider-arn`, `role-arn/{repo}` |
| `AccountSettings`                    | IAM alias and password policy, S3 Block Public Access, EBS default encryption, Access Analyzer  | -                                                     |
| `Dns` / `EdgeCertificate`            | Hosted zone, delegation (same or cross-account), regional and `us-east-1` wildcard certificates | `env/{env}/dns/*`, `env/{env}/certs/*`                |
| `Alerting`                           | SNS topic per severity, email subscriptions, publish permissions for alarms/events/budgets      | `env/{env}/alerts/topic-arn/{severity}`               |
| `EventBusModule`                     | Event bus, archive, org/account `PutEvents` policies, optional all-events log                   | `env/{env}/events/bus-name`, `bus-arn`                |
| `Encryption`                         | Rotating KMS key with alias and policies for platform services                                  | `account/kms/key-arn`, `key-id`                       |
| `SharedParameters` / `SharedSecrets` | Map-driven config values and generated secrets                                                  | `config/{key}`, `secrets/{name}/arn`                  |
| `Budgets`                            | Monthly cost budget with actual and forecast notifications                                      | -                                                     |
| `Security`                           | CloudTrail, AWS Config, GuardDuty, Security Hub (each optional)                                 | `account/security/cloudtrail-bucket-name`             |
| `Network`                            | VPC (isolated by default), gateway and interface endpoints, Lambda security group, flow logs    | `account/vpc/*`                                       |
| `LogRetention`                       | Scheduled and event-driven sweeper applying the default log retention                           | `account/log-retention-days`                          |

Protected environments (`protected: true`) retain stateful resources on delete, enable stack
termination protection and never trust `pull_request` tokens.

## Deploy roles

Deploy roles can only assume the CDK bootstrap roles (`cdk-<qualifier>-*`) for the account and
region and read CloudFormation stack state; permissions are therefore defined by `cdk bootstrap`,
not by this package. Stack outputs `DeployRoleArn<Owner><Repo>` and
`ReadOnlyRoleArn<Owner><Repo>` are the values for the `AWS_DEPLOY_ROLE_ARN_<ENV>` and
`AWS_READONLY_ROLE_ARN_<ENV>` repository variables.

## Organisation rollout

- `PlatformStackSet` deploys any CDK stack to every account of an OU (service-managed, auto
  deployment, `addDependency` ordering) from the management or a delegated administrator
  account. The template is synthesised in a nested stage and embedded inline, or uploaded as an
  asset above 50 KB. Templates must be asset-free (inline Lambda code) unless every target
  account has the CDK asset bucket.
- `OrganizationsAccessRole` creates narrowly trusted cross-account roles, with presets
  `dnsDelegation(zone)` (for `CrossAccountZoneDelegationRecord`) and `parameterReader()`.
- `AccountNameLookup` resolves the Organizations account name at deploy time and
  `environmentFromAccountName("my-platform-dev", { apexDomain: "example.com", workloadPrefix: "my-platform-" })`
  derives `{ env: "dev", domain: "dev.example.com" }` for account-per-environment layouts.

```ts
new PlatformStackSet(adminStack, "Baseline", {
  stackSetName: "platform-baseline",
  template: (scope) => new AccountBaselineTemplateStack(scope, "Template"),
  targets: { organizationalUnitIds: ["ou-example-workloads"], regions: ["eu-west-1"] },
});
```
