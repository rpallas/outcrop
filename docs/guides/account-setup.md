# Account setup

The account baseline is a CDK app that uses `@rpallas/outcrop-account`. It provisions what
services expect to find in an account and publishes it to the SSM contract. Scaffold one with:

```bash
npx @rpallas/outcrop-cli create account my-platform --owner my-org --domain example.com
cd my-platform
```

## Prerequisites

- `npx cdk bootstrap aws://111111111111/eu-west-1` in each target account (and `aws://111111111111/us-east-1` when the DNS module is on and the region is not `us-east-1`, for the CloudFront certificate stack)
- A registered domain and the ability to create NS records for delegation, or a parent hosted zone (same or another account) configured as `parentZone`
- Administrator credentials for the first deploy

## Configure

`account.config.ts` lists environments and, per environment, the account id, region, domain and
the GitHub repositories allowed to deploy:

```ts
export default defineAccountConfig({
  project: "my-platform",
  environments: {
    dev: {
      account: "111111111111",
      region: "eu-west-1",
      domain: "dev.example.com",
      alertEmails: ["platform-alerts@example.com"],
      monthlyBudgetUsd: 200,
      github: [{ owner: "my-org", repo: "orders" }], // pull requests allowed by default
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
```

`lib/modules.ts` chooses the modules. Everything not listed is off:

```ts
export const modules: AccountBaselineModules = {
  githubOidc: true,
  accountSettings: true,
  dns: true,
  alerting: true,
  eventBus: true,
  encryption: true,
  sharedParameters: { values: { "auth0-domain": "example.eu.auth0.com" } },
  sharedSecrets: { secrets: { "neon-api-key": {} } },
  budgets: true,
  security: true, // disable pieces managed by your organisation: { guardDuty: false }
  logRetention: true,
  // network: { natGateways: 0 },
};
```

## First deploy

```bash
npm test
npx cdk deploy --all -c env=dev
```

Outputs include:

- `DeployRoleArn<Owner><Repo>` / `ReadOnlyRoleArn<Owner><Repo>`: set them as `AWS_DEPLOY_ROLE_ARN_DEV` and `AWS_READONLY_ROLE_ARN_DEV` repository variables in each service repository
- `BaselineDnsNameServers`: NS records to create at your registrar or parent zone (not needed when `parentZone` is configured)
- `EventBusName`, `PlatformKeyArn`, `CriticalAlertTopicArn`

Confirm the SNS email subscriptions from your inbox.

## Ongoing deploys from CI

The baseline creates the service deploy roles, so it cannot deploy itself with one of them the
first time. Create one administration role per account trusted by the GitHub OIDC provider (the
provider ARN is in the `/platform/account/deploy/oidc-provider-arn` parameter), store its ARN as
`AWS_BASELINE_ROLE_ARN_<ENV>`, and let the generated `.github/workflows/deploy.yml` call the
`account-baseline-deploy.yml` reusable workflow on merges to `main`.

The deploy jobs run in a GitHub environment named after the platform environment, so the OIDC
`sub` claim is `repo:my-org/my-platform:environment:<env>` rather than the branch ref. Trust that
value, and restrict the GitHub environment's deployment branches to `main`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:my-org/my-platform:environment:dev"
        }
      }
    }
  ]
}
```

## Shared secrets

`SharedSecrets` creates secrets with generated values and publishes their ARNs. Replace the
value out of band so no secret material passes through CloudFormation:

```bash
aws secretsmanager put-secret-value --secret-id platform-dev-neon-api-key --secret-string "$NEON_API_KEY"
```

## Organisation-wide rollout

Wrap the baseline in `PlatformStackSet` to deploy it to every account in an OU from a delegated
administrator account. See the `outcrop-account` README.
