# Account setup

The account baseline is a CDK app that uses `@rpallas/platform-cdk-account`. Scaffold one with:

```bash
npx @rpallas/platform-cdk-cli create account my-platform-accounts
cd my-platform-accounts
```

## Prerequisites

- `npx cdk bootstrap aws://111111111111/eu-west-1` in each target account
- A registered domain and the ability to create NS records for delegation (or a hosted zone already in the account)

## Configure

`account.config.ts` lists environments and, per environment, the account id, region, domain and the GitHub repositories allowed to deploy:

```ts
export default defineAccountConfig({
  project: "my-platform",
  environments: {
    dev: {
      account: "111111111111",
      region: "eu-west-1",
      domain: "dev.example.com",
      github: [{ owner: "my-org", repo: "orders", allowPullRequests: true }],
    },
    prod: {
      account: "222222222222",
      region: "eu-west-1",
      domain: "example.com",
      protected: true,
      github: [{ owner: "my-org", repo: "orders" }],
    },
  },
});
```

## Deploy

The first deploy is manual with your own credentials; afterwards the `account-baseline-deploy.yml` reusable workflow can take over using the roles it created.

```bash
npx cdk deploy -c env=dev --all
```

Outputs include the deploy role ARNs to paste into GitHub repository variables and the hosted zone name servers for delegation.

## Modules

`AccountBaseline` accepts a module map; everything not listed is off:

- `githubOidc`, `accountSettings`, `dns`, `alerting`, `eventBus`, `encryption`, `sharedParameters`, `sharedSecrets`, `budgets`, `security`, `network`, `logRetention`

## Organisation-wide rollout

Wrap the baseline in `PlatformStackSet` to deploy it to every account in an OU from a delegated administrator account. See the `platform-cdk-account` README.
