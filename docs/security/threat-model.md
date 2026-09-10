# Threat model

This document records what the platform protects, the trust boundaries it assumes and the controls that ship by default. It is written for people adopting the library, so it is deliberately concrete about defaults; anything not listed here is not a guarantee.

## Assets

| Asset                            | Where it lives                                                                               | Why it matters                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| AWS accounts and their workloads | One account per environment (`dev`, `stage`, `prod`) or shared account with isolation prefix | Full compromise of an account is the worst case          |
| Deploy credentials               | Short-lived STS credentials from GitHub OIDC; no long-lived keys anywhere                    | The main path from GitHub to AWS                         |
| Shared secrets                   | Secrets Manager under `platform-<env>-*`, values never in git or CloudFormation              | Third-party API keys, database credentials, webhook URLs |
| Customer data                    | DynamoDB tables, S3 buckets, Neon databases created by services                              | Confidentiality and integrity                            |
| Public entry points              | HTTP API, REST API, WebSocket API, CloudFront distributions, `*.dev.example.com` previews    | Abuse, data exfiltration, cost                           |
| Event bus                        | One `platform-<env>-events` bus per environment                                              | Spoofed or replayed events cause incorrect processing    |
| Observability data               | CloudWatch logs and metrics                                                                  | Logs may contain PII if handlers log request bodies      |

## Trust boundaries

1. **GitHub to AWS.** A workflow run assumes `platform-<env>-deploy-<owner>-<repo>` through the GitHub OIDC provider. The trust policy pins the repository, the branch or the GitHub environment and, for non-protected environments only, `pull_request` events. Protected environments (`protected: true`) require a GitHub environment, so branch protection and required reviewers gate production deploys.
2. **Deploy role to CloudFormation.** The deploy role can only assume the CDK bootstrap roles, describe stacks and read the bootstrap version. All resource creation happens through the CloudFormation execution role created by `cdk bootstrap`. Restrict that role with `--cloudformation-execution-policies` when the default `AdministratorAccess` is not acceptable (see [SCP compatibility](scp-compatibility.md)).
3. **Preview stacks to base environments.** Previews share the `dev` account with the base `dev` stack. They are isolated by name prefix, separate IAM roles per function and per-stack removal policies, not by account. Anything that must not be reachable from a preview belongs in `stage` or `prod`.
4. **Services to the account baseline.** Services read shared values from SSM under `/platform` and shared secrets from Secrets Manager. Only the baseline writes to `/platform/account/*` and `/platform/env/*`; services write to `/platform/service/<service>/*` through `PlatformParameter`.
5. **Internet to services.** All public endpoints are HTTPS only (TLS 1.2+), fronted by API Gateway or CloudFront. WAF (`PlatformWebAcl`) is optional but the constructs make it a one-liner.

## Threats and controls

| Threat                                             | Control in the defaults                                                                                                                                                                      | Residual risk / adopter action                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Fork PR runs a workflow with deploy credentials    | GitHub does not expose `id-token` to fork PRs; the preview workflow additionally checks `github.event.pull_request.head.repo.full_name == github.repository`                                 | Protect `dev` too if the repository is public and previews are sensitive                           |
| Stolen `GITHUB_TOKEN` used to deploy               | `GITHUB_TOKEN` cannot assume the deploy role; only the OIDC token of a matching workflow run can                                                                                             | Keep `permissions` minimal in caller workflows (the reusable workflows request only what they use) |
| Malicious dependency in a service repository       | Provenance is enforced on this repository's packages (`npm publish --provenance`); Renovate pins ranges; the runtime layer contains only Powertools                                          | Adopters should enable Dependabot/Renovate and `npm audit` in `service-checks`                     |
| Over-privileged Lambda functions                   | One execution role per function, grants through L2 `grant*` methods; cdk-nag `AwsSolutions` runs in tests and fails on wildcard actions without a justification                              | Review the `IAM5` suppressions list in `test/nag.test.ts` when adding constructs                   |
| Preview stack leaks data from the base environment | Previews get their own tables, queues and buckets; `PlatformTable`/`PlatformBucket` in previews are `DESTROY` with auto-delete so nothing persists after PR close                            | Do not seed previews with production data                                                          |
| Orphaned previews accrue cost or exposure          | `service-preview-destroy` runs on PR close; `examples-preview-destroy` is the dogfood; `platform:preview-id` tags allow sweepers                                                             | Add a scheduled sweeper if PRs are commonly closed while CI is disabled                            |
| Secret values committed to git                     | gitleaks and the denylist test run in CI; templates only reference secrets by name/ARN; `PlatformSecret` generates values server-side                                                        | Adopters should keep gitleaks in their own CI (`service-checks` includes it)                       |
| Unencrypted data at rest                           | KMS CMK per environment (`alias/platform-<env>-key`) with rotation; tables, queues, topics, buckets and logs use it when `account.kmsKey` is present; SSE-S3/SQS-managed otherwise           | Grant `kms:Decrypt` explicitly to cross-account consumers                                          |
| Public S3 buckets                                  | Account-level Block Public Access, bucket-level block, SSL-only policies, versioning on, CloudFront OAC for static sites                                                                     | None known                                                                                         |
| Spoofed events on the shared bus                   | Bus policy only allows the organisation or explicit accounts; rules match on `source` = service name so a service cannot subscribe to its own spoofed source without IAM permissions         | Sign event bodies if consumers act on financial data                                               |
| Unauthenticated API access                         | Scaffolded stacks always set `defaultAuthorizer` explicitly so a public API is a visible choice (`PlatformHttpAuthorizers.none()`); JWT (Auth0/Cognito), Lambda and API-key authorizers ship | Rate limits are per-stage throttles; add `PlatformWebAcl` for IP-based rules                       |
| Abuse driving cost                                 | Budgets at 80/100 % actual and 100 % forecast alert to the high-severity topic; API throttling defaults (burst 200, rate 100 rps) on every stage                                             | Tune throttles per route where needed                                                              |
| Log data disclosure                                | Logs encrypted with the CMK, retention 90 days (7 in previews); the runtime logger only records request metadata (method, path, status, request id), never headers or bodies                 | Do not log request bodies or headers with PII                                                      |
| Account-wide misconfiguration                      | `Security` module: CloudTrail, AWS Config, GuardDuty, Security Hub with the Foundational Security Best Practices standard; `AccountSettings`: password policy, EBS encryption                | Manage these centrally in an organisation and disable duplicates                                   |
| Lost audit trail                                   | CloudTrail to a versioned, KMS-encrypted bucket with retention; Config recorder for all resource types                                                                                       | Forward to a central log-archive account in multi-account setups                                   |

## Out of scope

- Application-level authorisation (who can see which record): the authorizers establish identity, services decide access.
- Protecting the GitHub organisation itself (SSO, 2FA, branch protection). The platform assumes those are in place; see [GitHub setup](../guides/github-setup.md).
- Runtime protection inside Lambda (e.g. RASP). Lambda's execution isolation plus least-privilege roles are the boundary.
- Data residency: the baseline is single-region per environment; adopters choose the region.

## Reviewing changes against this model

When a change touches IAM, network exposure or the SSM/Secrets contract, the pull request should answer:

1. Which trust boundary does the change cross or introduce?
2. Which row in the table above covers it, or what new row is needed?
3. Does cdk-nag stay green (`packages/platform-cdk/test/kitchen-sink.test.ts`, `packages/platform-cdk-account/test/account-baseline.test.ts`) without new `IAM5`/`APIG4`/`COG4` suppressions? If not, why is the suppression justified?
