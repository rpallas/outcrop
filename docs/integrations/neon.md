# Neon Postgres branches for previews

`@rpallas/platform-cdk-neon` gives every preview stack its own Neon Postgres branch, created from
the environment's base branch and deleted with the stack. The connection details are written to a
Secrets Manager secret owned by the stack, so the same service code reads one secret everywhere:
in previews it points at the branch, in base environments at the shared `neon-connection` secret.

## Setup

1. Create a Neon project and note its project id.
2. Add `neon-api-key` to the account baseline's `sharedSecrets` module and replace the generated
   value with a Neon API key (`aws secretsmanager put-secret-value --secret-id platform-dev-neon-api-key ...`).
3. Store the base environment's connection details in a shared `neon-connection` secret (same
   JSON shape the construct writes, see the package README).
4. Add the construct to the service stack:

```ts
import { NeonBranch } from "@rpallas/platform-cdk-neon";

const db = new NeonBranch(this, "Db", { projectId: "proud-lake-123456" });
db.grantRead(apiFunction);
```

## How it fits the preview model

Preview stacks (ADR 0004) are isolated copies of a service keyed by a preview id. `NeonBranch`
follows the same rule: the branch is named `<previewId>-<service>-db`, the secret
`<previewId>-<service>-neon-connection`, and both disappear when the preview stack is destroyed.
Branches are copy-on-write and auto-suspend, so idle previews cost close to nothing.

The stack output `DbConnectionSecretArn` lets the deploy workflow run migrations against the new
branch right after `cdk deploy`; the package README has a GitHub Actions snippet.

See the [package README](../../packages/platform-cdk-neon/README.md) for all props, the secret
format, update semantics and limitations.
