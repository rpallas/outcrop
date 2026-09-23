# @rpallas/outcrop-neon

A [Neon](https://neon.tech) Postgres branch per preview stack for services built with
`@rpallas/outcrop`. Each preview deployment gets its own database branch created from a
parent branch, the connection details land in a Secrets Manager secret owned by the stack, and the
branch is deleted with the stack. Base environments (`dev`, `prod`, ...) import a shared connection
secret instead, so the same code works everywhere.

```sh
npm install @rpallas/outcrop-neon
```

## Prerequisites

- A Neon project. Note its project id (`Project settings` → `General` in the Neon console).
- A Neon API key stored as the shared secret `neon-api-key` by the account baseline
  (`@rpallas/outcrop-account`, `sharedSecrets: { secrets: { "neon-api-key": {} } }`). The
  baseline generates a placeholder value; replace it out of band once:

  ```sh
  aws secretsmanager put-secret-value \
    --secret-id platform-dev-neon-api-key \
    --secret-string 'napi_...'
  ```

  Either a plain string or a JSON document `{ "apiKey": "napi_..." }` is accepted.

- For base environments, a shared secret `neon-connection` holding the connection details of the
  environment's own branch (the same JSON shape the construct writes, see below, or any shape your
  service expects). Previews never read this secret.

## Usage

```ts
import { PlatformFunction, PlatformStack } from "@rpallas/outcrop";
import { NeonBranch } from "@rpallas/outcrop-neon";

export class OrdersStack extends PlatformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const db = new NeonBranch(this, "Db", {
      projectId: "proud-lake-123456",
      parentBranch: "main", // default
      database: "neondb", // default
      role: "neondb_owner", // default
    });

    const api = new PlatformFunction(this, "Api", {
      entry: "src/api.ts",
      environment: { DB_SECRET_ARN: db.connectionSecret.secretArn },
    });
    db.grantRead(api);
  }
}
```

At runtime read the secret (for example with `getSecretJson` from `@rpallas/outcrop-runtime`)
and use `connectionString`:

```json
{
  "host": "ep-cool-river-123456.eu-central-1.aws.neon.tech",
  "pooledHost": "ep-cool-river-123456-pooler.eu-central-1.aws.neon.tech",
  "port": 5432,
  "database": "neondb",
  "user": "neondb_owner",
  "password": "...",
  "connectionString": "postgresql://neondb_owner:...@ep-cool-river-123456-pooler.eu-central-1.aws.neon.tech:5432/neondb?sslmode=require",
  "directConnectionString": "postgresql://...@ep-cool-river-123456.eu-central-1.aws.neon.tech:5432/neondb?sslmode=require",
  "pooledConnectionString": "postgresql://...@ep-cool-river-123456-pooler.eu-central-1.aws.neon.tech:5432/neondb?sslmode=require",
  "branchId": "br-new-000002",
  "projectId": "proud-lake-123456"
}
```

`connectionString` points at the connection pooler (right for Lambda) unless `pooled: false`.
`directConnectionString` is always the direct endpoint, which is what migrations and anything that
uses session-level features (advisory locks, `LISTEN`/`NOTIFY`, prepared statements) should use.

### Props

| Prop                       | Default                            | Notes                                                                  |
| -------------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| `projectId`                | required                           | Neon project id                                                        |
| `apiKeySecretName`         | `neon-api-key`                     | Shared secret name resolved through `/platform/secrets/{name}/arn`     |
| `apiKeySecret`             | –                                  | Explicit `ISecret` instead of `apiKeySecretName`                       |
| `parentBranch`             | `main`                             | Name or `br-...` id. `main` falls back to the project's default branch |
| `branchName`               | `<previewId>-<service>-db`         | Platform naming, kind `generic`, name `db`                             |
| `database`                 | `neondb`                           |                                                                        |
| `role`                     | `neondb_owner`                     | Role whose password is stored                                          |
| `createInBaseEnvironment`  | `false`                            | Also create a branch (`<service>-db`) in non-preview stacks            |
| `baseConnectionSecretName` | `neon-connection`                  | Shared secret imported when no branch is created                       |
| `pooled`                   | `true`                             | `connectionString` uses the pooler host                                |
| `suspendTimeoutSeconds`    | Neon default                       | Compute auto-suspend timeout for the branch endpoint                   |
| `apiBaseUrl`               | `https://console.neon.tech/api/v2` |                                                                        |

### What the construct exposes

- `connectionSecret: ISecret` – the stack's own secret in previews, the shared secret otherwise
- `isBranch: boolean` – whether this deployment manages a branch
- `branchId`, `host`, `pooledHost` – deploy-time tokens (`undefined` when no branch is created)
- `handler`, `resource` – the custom resource pieces, for extra permissions or dependencies
- `grantRead(grantee)` – read access to the connection secret
- A stack output `<Id>ConnectionSecretArn` (for `Db` above: `DbConnectionSecretArn`) so CI can find
  the secret after a deploy

## How previews map to branches

| Stack                                | Branch                                | Secret                                   |
| ------------------------------------ | ------------------------------------- | ---------------------------------------- |
| Preview `pr-42` of `orders`          | `pr-42-orders-db` created from `main` | `pr-42-orders-neon-connection` (created) |
| `dev` / `prod` (default)             | none                                  | shared `neon-connection` (imported)      |
| `dev` with `createInBaseEnvironment` | `orders-db` created from `main`       | `orders-neon-connection` (created)       |

The custom resource:

1. reads the API key, resolves the parent branch id and creates the branch with a `read_write`
   endpoint (`POST /projects/{id}/branches`), polling the returned operations until they finish;
2. reads the role password (`reveal_password`, falling back to `reset_password` when revealing is
   disabled for the project) and writes the JSON above with `PutSecretValue`. The secret value
   never appears in a CloudFormation template or in the custom resource response;
3. deletes the branch when the stack is destroyed (a branch that is already gone is not an error).

A `Create` that finds a branch with the same name adopts it instead of failing, so a retried deploy
after a timeout converges. Changing `branchName` (or `projectId`) creates a new branch and returns a
new physical id; CloudFormation then deletes the old branch. A branch's parent is immutable in
Neon, so changing only `parentBranch` is ignored with a warning – rename the branch as well.

## Cost notes

Neon bills compute time and storage. Preview branches share storage with their parent
(copy-on-write) and their compute auto-suspends when idle, so an idle preview costs close to
nothing. Use `suspendTimeoutSeconds` to suspend sooner, and make sure preview stacks are destroyed
when pull requests close (the platform workflows do this) so branches do not accumulate. Every
branch counts towards the project's branch limit.

## Running migrations after a preview deploy

The deploy job exposes stack outputs; use the connection secret output to run migrations with the
direct endpoint:

```yaml
- name: Deploy preview
  id: deploy
  run: npx cdk deploy --require-approval never --outputs-file cdk-outputs.json

- name: Run migrations
  env:
    STACK_NAME: ${{ steps.deploy.outputs.stack-name }}
  run: |
    SECRET_ARN=$(jq -r ".[\"$STACK_NAME\"].DbConnectionSecretArn" cdk-outputs.json)
    export DATABASE_URL=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" \
      --query SecretString --output text | jq -r .directConnectionString)
    npm run migrate
```

The deploy role needs `secretsmanager:GetSecretValue` on the stack's secrets for this step.

## Limitations

- One branch per construct; a stack can create several by using different `branchName`s.
- The handler requires outbound internet access to the Neon API. If the function runs inside a VPC
  it needs a NAT gateway or equivalent.
- Only the password of `role` is stored. Additional roles or databases are not created.
- `parentBranch` is resolved by name at create time; renaming the parent later has no effect.
- Neon API rate limits apply; the handler retries nothing beyond polling operations, and a failed
  API call fails the deployment so CloudFormation can roll back.
