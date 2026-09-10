---
name: account-baseline
description: Set up or change an AWS account baseline built with @rpallas/platform-cdk-account (GitHub OIDC deploy roles, DNS and certificates, alert topics, event bus, KMS, shared parameters and secrets, budgets, security services, log retention, StackSets). Use when onboarding a new AWS account or environment, adding a repository that must deploy, changing alerting or shared configuration, or when the user mentions the account baseline or the /platform SSM contract.
---

# Account baseline

## New baseline

```sh
npx @rpallas/platform-cdk-cli create account <name> --owner <github-owner> --domain <apex-domain> \
  --region <region> --dev-account <id> --prod-account <id>
cd <name> && npm test
npx cdk bootstrap aws://<account>/<region>        # once per account/region (and us-east-1 when DNS is on)
npx cdk deploy --all -c env=dev                   # with administrator credentials the first time
```

Outputs give the `AWS_DEPLOY_ROLE_ARN_<ENV>` / `AWS_READONLY_ROLE_ARN_<ENV>` values for service repositories and the name servers to delegate.

## Common changes

| Task                              | Edit                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| Let a repository deploy to an env | `account.config.ts` -> `environments.<env>.github.push({ owner, repo, allowPullRequests })`       |
| Add shared config for services    | `lib/modules.ts` -> `sharedParameters.values["key"] = "value"` (read with `params.config("key")`) |
| Add a shared secret               | `lib/modules.ts` -> `sharedSecrets.secrets["name"] = {}`; set the value with `put-secret-value`   |
| Route alerts to Slack/Teams       | Add `@rpallas/platform-cdk-chatops` `ChatOpsNotifier` with the topics from `baseline.alerting`    |
| Change budgets or alert emails    | `environments.<env>.monthlyBudgetUsd`, `environments.<env>.alertEmails`                           |
| Give Lambda functions a VPC       | `lib/modules.ts` -> `network: { natGateways: 0 }` (endpoints only) or `natGateways: 1`            |
| Organisation-wide rollout         | Wrap the template in `PlatformStackSet` from a delegated administrator account                    |

Then `npm test` (snapshots per environment) and merge; `.github/workflows/deploy.yml` deploys `dev` then `prod`.

## Rules

- Never put account ids, secrets or webhook URLs anywhere except `account.config.ts` (ids) and Secrets Manager (values).
- Protected environments (`protected: true`) never trust `pull_request` tokens and retain stateful resources; do not override this.
- Everything the baseline creates is published under `/platform/...` (ADR 0003). Services must read from there instead of duplicating resources.
- Disable `security` sub-features that the organisation manages centrally (`security: { guardDuty: false, securityHub: false }`) instead of deploying duplicates.
