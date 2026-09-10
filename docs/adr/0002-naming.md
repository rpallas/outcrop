# ADR 0002: Physical resource naming

Status: accepted

## Context

Preview stacks must coexist with the base stack in the same account, and some users run several environments in one account. AWS resources have different name length limits and character sets. Predictable names are needed for cross-stack lookups, dashboards and CLI scripts.

## Decision

Every physical name is produced by `PlatformNaming`:

- Segments in order: `previewId` (preview only), `env` (only when `isolation: "shared"`), `service`, `name`.
- Segments are sanitised per `ResourceKind` (for example S3 forces lowercase, IAM allows `+=,.@_`).
- Joined with `-`; when the result exceeds the kind's limit the `hashTail` strategy keeps a stable 7-character base36 hash suffix so collisions stay unlikely and names stay deterministic.
- Stack names use the same rule with the service in PascalCase, e.g. `abc-123-Orders`.
- Custom domains use a configurable pattern, default `{service}-{previewId}.{envDomain}`, so the account wildcard certificate covers previews.

## Consequences

- Names are stable between synths and unique per preview.
- Consumers never concatenate strings for names; the `ResourceKind` table is the single source of truth for limits.
