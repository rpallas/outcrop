# ADR 0004: Preview stack model

Status: accepted

## Context

Every pull request should deploy a working copy of the service that reviewers and integration tests can hit, without interfering with the shared development environment or other open pull requests.

## Decision

- A preview is a normal deployment of the service into the `preview.targetEnvironment` (default `dev`) with `-c preview=true -c previewId=<id>`.
- `previewId` is derived from the branch name: the first `letters-digits` ticket reference (e.g. `abc-123`), otherwise `pr-<number>`. The same parser is used by the CLI and the composite action so CI and CDK agree.
- All physical names carry the `previewId` prefix; the stack is `<previewId>-<Service>`.
- Stateful resources use `RemovalPolicy.DESTROY`, S3 buckets auto-delete objects, DynamoDB disables point-in-time recovery, log retention is one week.
- Each preview gets its own HTTP API and hostname `{service}-{previewId}.{envDomain}` covered by the environment wildcard certificate.
- Previews deploy on pull request open and synchronise, are destroyed on close, and a `skip-preview` label disables them. Concurrency is one deploy per pull request.
- There is no time-based janitor in v1; stacks are tagged with `platform:pr-number` and `platform:repository` so one can be added later.

## Consequences

- Previews are cheap to create and impossible to leave behind accidentally on merge.
- Integration tests read stack outputs and run against real infrastructure before merge.
