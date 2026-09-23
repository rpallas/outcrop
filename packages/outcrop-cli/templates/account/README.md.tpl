# {{name}}

Account baseline for **{{project}}**, built with [outcrop](https://github.com/rpallas/outcrop).
It provisions everything services expect to find in an account: GitHub OIDC deploy roles, DNS
and certificates, alert topics, the event bus, the KMS key, shared parameters and secrets,
budgets, security services and log retention, and publishes them to the SSM contract under
`/platform`.

## First deploy

```bash
npm ci
npm test
# once per account and region
npx cdk bootstrap aws://{{devAccount}}/{{region}}
# with administrator credentials for the dev account
npx cdk deploy --all -c env=dev
```

The stack outputs list the deploy role ARNs (`AWS_DEPLOY_ROLE_ARN_*`) to set as repository
variables in each service repository, and the hosted zone name servers to delegate from your
registrar or parent zone.

## Ongoing deploys

Merges to `main` run `.github/workflows/deploy.yml`, which deploys `dev` then `prod` using
`AWS_BASELINE_ROLE_ARN_<ENV>` repository variables pointing at an administration role you
create once (the baseline itself creates the service deploy roles).

## Layout

- `account.config.ts` - environments, accounts, domains, repositories, budgets
- `lib/modules.ts` - which baseline modules are enabled and their options
- `bin/app.ts` - CDK app entry (`createAccountBaseline`)
- `test/` - snapshot tests per environment
