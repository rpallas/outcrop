# Roadmap

The library is Lambda-first by design ([ADR 0001](adr/0001-monorepo-and-packaging.md)). Items below are either planned or explicitly deferred, with the reasoning so contributors know where a pull request will land.

## Shipping in 1.x

- Streaming: `PlatformStream` (Kinesis Data Streams) and `PlatformDeliveryStream` (Firehose to S3) shipped in 1.0; enhanced fan-out consumers and Firehose transformations to follow.
- `PlatformPythonFunction`: Python handlers packaged with the CDK Python bundling image, sharing the same alarms, logging and naming as `PlatformFunction`. Shipped in 1.0 without a Python runtime package; the JSON log format and `PLATFORM_*` environment variables are documented for hand-rolled helpers.
- Runtime helpers for Step Functions task tokens and Scheduler payloads.
- CLI `add` sub-command to add a variant to an existing service instead of only at creation time.
- Preview sweeper workflow that destroys previews older than a configurable age when PR close events were missed.
- Generated dashboards per service published to a `docs`-style landing page in CloudWatch.

## Deferred

### Containers (ECS / App Runner / EKS)

Not planned for the core library. The naming, SSM and preview model are all compute-agnostic, so an `@rpallas/platform-cdk-containers` package could exist, but the reusable workflows, cost model (per-preview stacks that idle at zero cost) and alarm set are all built around Lambda. Services that outgrow Lambda should move to a dedicated ECS platform rather than force the preview model onto long-running tasks. Lambda container images (`DockerImageFunction`) are a supported middle ground and can be added to `PlatformFunction` without changing the model.

### Relational databases on AWS (RDS / Aurora)

Deferred in favour of Neon branches per preview (`@rpallas/platform-cdk-neon`). Aurora Serverless v2 previews take 10+ minutes to create and cost money while idle, which breaks the "a preview per PR" promise. Aurora for `prod` only is a reasonable extension once the Neon integration has stabilised.

### Multi-region

The baseline is single-region per environment with `us-east-1` for edge certificates. Active-active multi-region deployments need global tables, Route 53 health checks and per-region SSM contracts; the parameter paths already carry no region, so it is possible, but not planned until there is a concrete adopter.

### Other observability vendors

CloudWatch alarms, dashboards and logs are the only supported model. Forwarding is a per-adopter concern (Kinesis Firehose subscription filters are easy to add with `PlatformDeliveryStream`).

## Versioning

Packages release together as a fixed group through changesets. Breaking changes to the SSM contract or the preview model require a major version and an ADR; the reusable workflows keep a floating `v1` tag that is moved on every 1.x release.
