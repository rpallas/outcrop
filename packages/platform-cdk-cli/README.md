# @rpallas/platform-cdk-cli

Scaffolding and CI helpers for services built with [`@rpallas/platform-cdk`](../platform-cdk).

```sh
npx @rpallas/platform-cdk-cli create service orders --http-api --dynamodb --auth jwt-auth0
npx @rpallas/platform-cdk-cli create account my-platform --owner my-org --domain example.com
npx @rpallas/platform-cdk-cli preview-id --branch feature/ABC-123-thing --pr 42   # abc-123
npx @rpallas/platform-cdk-cli stack-outputs --outputs-file cdk-outputs.json --prefix PREVIEW_ --github-env
npx @rpallas/platform-cdk-cli sync-skills
```

## Commands

| Command                 | Purpose                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `create service <name>` | Generates a complete service repository: infra, handlers, tests, workflows and docs.           |
| `create account <name>` | Generates an account baseline app using `@rpallas/platform-cdk-account`.                       |
| `preview-id`            | Derives the preview id (`abc-123` from a ticket in the branch name, else `pr-<n>`).            |
| `stack-outputs`         | Reads CloudFormation outputs (from `cdk deploy --outputs-file` or the API) and exports them.   |
| `sync-skills`           | Copies the bundled agent skills into `.agents/skills` so coding agents follow the conventions. |

### Service variants

Variants can be combined: `--http-api`, `--queue-consumer`, `--event-subscriber`, `--scheduled`,
`--static-site`, `--dynamodb`, `--neon`. `--auth none|jwt-auth0|jwt-cognito|api-key` protects the
HTTP API. The generated `infra/lib/service-stack.ts` is plain CDK code intended to be edited; the
templates are a starting point, not a framework.

Generated repositories consume the reusable workflows from this repository
(`rpallas/platform-cdk/.github/workflows/*.yml@v1`) and expect these repository variables:
`AWS_REGION`, `AWS_DEPLOY_ROLE_ARN_DEV` (and `_PROD`, `AWS_READONLY_ROLE_ARN_DEV` for diffs).

Run `platform-cdk create service --help` for the full option list.
