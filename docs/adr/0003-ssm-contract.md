# ADR 0003: SSM parameter contract between account and services

Status: accepted

## Context

Services need account-level values (hosted zone, certificates, alert topics, event bus, KMS key, VPC). Hardcoding ARNs or CloudFormation exports couples services to specific accounts and makes previews and multi-account rollout brittle.

## Decision

`AccountBaseline` publishes well-known SSM parameters and `PlatformParameters` reads them. Root prefix defaults to `/platform` and is configurable.

Account-scoped (one per account):

- `/platform/account/id`, `/platform/account/name`
- `/platform/account/kms/key-arn`
- `/platform/account/vpc/id`, `/platform/account/vpc/private-subnet-ids`, `/platform/account/vpc/public-subnet-ids`, `/platform/account/vpc/availability-zones`
- `/platform/account/deploy/oidc-provider-arn`, `/platform/account/deploy/role-arn/{repo}`
- `/platform/account/log-retention-days`

Environment-scoped (one set per environment; a single set in account-isolated accounts):

- `/platform/env/{env}/name`, `/platform/env/{env}/domain`
- `/platform/env/{env}/dns/zone-id`, `/platform/env/{env}/dns/zone-name`
- `/platform/env/{env}/certs/regional-arn`, `/platform/env/{env}/certs/us-east-1-arn`
- `/platform/env/{env}/alerts/topic-arn/{critical|high|medium|low}`
- `/platform/env/{env}/events/bus-name`, `/platform/env/{env}/events/bus-arn`

Shared values:

- `/platform/config/{key}` for shared plain parameters
- `/platform/secrets/{name}/arn` for the ARN of shared Secrets Manager secrets

## Consequences

- A service can be deployed into any account that has the baseline applied, with no configuration beyond `platform.config.ts`.
- Values that must be known at synth time (zone id, certificate ARN) use context lookups; everything else uses deploy-time `{{resolve:ssm}}` tokens.
