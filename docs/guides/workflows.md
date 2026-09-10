# Reusable workflows

platform-cdk ships reusable GitHub Actions workflows and composite actions so a service repository
only needs three thin caller workflows. Everything authenticates with GitHub OIDC - no AWS access
keys are ever stored in GitHub.

Reference them as `rpallas/platform-cdk/.github/workflows/<file>@v1` (floating major) or pin a full
tag for reproducibility. The composite actions used by the workflows are documented in
[`.github/actions/README.md`](../../.github/actions/README.md).

## Prerequisites

### Repository variables

Set under _Settings > Secrets and variables > Actions > Variables_ (plain variables, not secrets):

| Variable                      | Used by                                  | Description                                                               |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| `AWS_REGION`                  | all                                      | Home region, e.g. `eu-west-1`.                                            |
| `AWS_DEPLOY_ROLE_ARN_DEV`     | preview deploy/destroy, `service-deploy` | Deploy role for `dev` (an output of the account baseline).                |
| `AWS_DEPLOY_ROLE_ARN_STAGE`   | `service-deploy`                         | Deploy role for `stage`.                                                  |
| `AWS_DEPLOY_ROLE_ARN_PROD`    | `service-deploy`                         | Deploy role for `prod`.                                                   |
| `AWS_READONLY_ROLE_ARN_DEV`   | `service-checks` (optional)              | Read-only role; enables `cdk diff` comments on pull requests.             |
| `AWS_BASELINE_ROLE_ARN_<ENV>` | `account-baseline-deploy` (optional)     | Bootstrap/administration role used to deploy the account baseline itself. |
| `SANDBOX_DEPLOY_ROLE_ARN`     | this repository only                     | Deploy role of the sandbox account used by the `examples-*` workflows.    |

`service-deploy.yml` looks up `AWS_DEPLOY_ROLE_ARN_<ENV>` (environment name upper-cased, `-` -> `_`)
for each environment unless the `role-arns` input provides it. Every role must trust the GitHub
OIDC provider for your repository.

### GitHub Environments

Create GitHub Environments named after your platform environments (`dev`, `stage`, `prod`). The
deploy workflows bind each job to the environment of the same name (`environment: <env>`), so
_required reviewers_, wait timers and branch protection configured on the environment gate the
deployment - add required reviewers on `prod`.

### The `skip-preview` label

Create a label named `skip-preview` (configurable via the `skip-label` input). Pull requests that
carry it do not get a preview environment; the sticky PR comment says so instead.

## Workflows

### `service-checks.yml`

Lint, test, `cdk synth` (uploads `cdk.out`) and, optionally, a `cdk diff` comment on pull requests
using a read-only role.

| Input                       | Type    | Default                                    | Description                                                      |
| --------------------------- | ------- | ------------------------------------------ | ---------------------------------------------------------------- |
| `working-directory`         | string  | `.`                                        | CDK app directory.                                               |
| `install-working-directory` | string  | `""` (= working-directory)                 | Where `npm ci` runs; pass `.` in a monorepo.                     |
| `build-command`             | string  | `""`                                       | Optional build command run after install (e.g. `npm run build`). |
| `node-version`              | string  | `""` (= `.nvmrc`)                          | Node.js version.                                                 |
| `lint-command`              | string  | `npm run lint --if-present`                |                                                                  |
| `test-command`              | string  | `npm test --if-present`                    |                                                                  |
| `synth-env`                 | string  | `dev`                                      | Environment for synth / diff.                                    |
| `synth-command`             | string  | `npx cdk synth -c env=<synth-env> --quiet` | Override.                                                        |
| `aws-region`                | string  | `""`                                       | Required for the diff job.                                       |
| `readonly-role-arn`         | string  | `""`                                       | Read-only role for `cdk diff`.                                   |
| `diff`                      | boolean | `false`                                    | Post `cdk diff` comment (needs `readonly-role-arn`, PR event).   |
| `runs-on`                   | string  | `ubuntu-latest`                            |                                                                  |

Permissions: `contents: read`, `id-token: write`, `pull-requests: write`.

### `service-preview-deploy.yml`

Deploys a per-pull-request preview and posts a sticky comment. Call it on
`pull_request: types: [opened, synchronize, reopened]`.

Steps: preview id (ticket in branch name, e.g. `ABC-123` -> `abc-123`, else `pr-<n>`), OIDC
login, `cdk deploy --all -c env=<target-env> -c preview=true -c previewId=<id> -c prNumber=<n>`,
stack outputs exported as `PREVIEW_<Key>` environment variables, base URL = first output whose key
ends with `BaseUrl`, optional integration tests (with `PREVIEW_ID`, `PREVIEW_BASE_URL` and all
outputs in the environment), then the comment (`deployed`, or `failed` on error). Concurrency group
`preview-<repo>-<pr>` cancels superseded runs.

| Input                       | Type   | Default                    | Description                                        |
| --------------------------- | ------ | -------------------------- | -------------------------------------------------- |
| `working-directory`         | string | `.`                        | CDK app directory.                                 |
| `install-working-directory` | string | `""` (= working-directory) | Where `npm ci` runs.                               |
| `build-command`             | string | `""`                       | Optional build command.                            |
| `node-version`              | string | `""`                       | Node.js version (empty = `.nvmrc`).                |
| `aws-region`                | string | required                   |                                                    |
| `role-arn`                  | string | required                   | Deploy role assumed via OIDC.                      |
| `target-env`                | string | `dev`                      | Environment hosting previews.                      |
| `strategy`                  | string | `ticket-then-pr`           | `ticket-then-pr`, `pr` or `branch-slug`.           |
| `skip-label`                | string | `skip-preview`             | Label that skips the preview.                      |
| `integration-test-command`  | string | `""`                       | Run from working-directory after deploy.           |
| `stacks`                    | string | `--all`                    | Stack names / wildcards.                           |
| `extra-context`             | string | `""`                       | Newline separated `key=value` context.             |
| `runs-on`                   | string | `ubuntu-latest`            |                                                    |
| `cli-version`               | string | `latest`                   | `@rpallas/platform-cdk-cli` version (`npx --yes`). |
| `cli-command`               | string | `""`                       | Explicit CLI command (local build).                |
| `output-prefix`             | string | `PREVIEW_`                 | Prefix for exported outputs.                       |

Outputs: `preview-id`, `base-url`, `stack-names`.
Permissions: `contents: read`, `id-token: write`, `pull-requests: write`.

### `service-preview-destroy.yml`

Destroys the preview of a closed pull request and updates the sticky comment to `destroyed`. Call
it on `pull_request: types: [closed]`. Same concurrency group as the deploy workflow, without
cancel-in-progress, so it waits for an in-flight deploy. Skips gracefully when no stacks exist.

Inputs: as `service-preview-deploy.yml` minus `skip-label`, `integration-test-command` and
`output-prefix`. Outputs: `preview-id`, `destroyed`.
Permissions: `contents: read`, `id-token: write`, `pull-requests: write`.

### `service-deploy.yml`

Deploys to an ordered list of environments, one after the other, each gated by the matching GitHub
Environment.

| Input                       | Type   | Default                    | Description                                                                |
| --------------------------- | ------ | -------------------------- | -------------------------------------------------------------------------- |
| `environments`              | string | `dev`                      | Ordered comma separated list, e.g. `dev,stage,prod` (max 3).               |
| `role-arns`                 | string | `""`                       | Newline separated `env=arn` pairs; preferred over `AWS_DEPLOY_ROLE_ARN_*`. |
| `working-directory`         | string | `.`                        | CDK app directory.                                                         |
| `install-working-directory` | string | `""` (= working-directory) | Where `npm ci` runs.                                                       |
| `build-command`             | string | `""`                       | Optional build command.                                                    |
| `node-version`              | string | `""`                       | Node.js version (empty = `.nvmrc`).                                        |
| `aws-region`                | string | required                   |                                                                            |
| `stacks`                    | string | `--all`                    | Stack names / wildcards.                                                   |
| `extra-context`             | string | `""`                       | Newline separated `key=value` context.                                     |
| `smoke-test-command`        | string | `""`                       | Run after each deploy with outputs and `DEPLOY_ENV` in the environment.    |
| `output-prefix`             | string | `STACK_`                   | Prefix for exported outputs.                                               |
| `runs-on`                   | string | `ubuntu-latest`            |                                                                            |
| `cli-version`               | string | `""`                       | CLI version for stack outputs (empty = jq / AWS CLI).                      |
| `cli-command`               | string | `""`                       | Explicit CLI command.                                                      |

Permissions: `contents: read`, `id-token: write`.

**Limitation.** Reusable workflows cannot create jobs dynamically, so the workflow contains a
`plan` job plus three explicit jobs `deploy-1` -> `deploy-2` -> `deploy-3`. At most three
environments are supported per call; call the workflow twice for longer pipelines. Job N deploys the
N-th environment and is skipped when the list is shorter.

### `account-baseline-deploy.yml`

Same plan + three sequential jobs pattern for an account baseline app
(`cdk deploy --all -c env=<env>`). Roles come from the `role-arns` input or the
`AWS_BASELINE_ROLE_ARN_<ENV>` variables.

| Input                       | Type   | Default                    |
| --------------------------- | ------ | -------------------------- |
| `environments`              | string | `dev`                      |
| `role-arns`                 | string | `""`                       |
| `working-directory`         | string | `.`                        |
| `install-working-directory` | string | `""` (= working-directory) |
| `build-command`             | string | `""`                       |
| `node-version`              | string | `""`                       |
| `aws-region`                | string | required                   |
| `stacks`                    | string | `--all`                    |
| `runs-on`                   | string | `ubuntu-latest`            |

Permissions: `contents: read`, `id-token: write`.

### Dogfooding workflows in this repository

`examples-preview.yml`, `examples-preview-destroy.yml` and `examples-deploy.yml` call the local
reusable workflows for `examples/hello-http`, passing `install-working-directory: .`,
`build-command: npm run build` and `cli-command: node ../../packages/platform-cdk-cli/bin/platform-cdk.js`
so the freshly built packages and CLI are exercised. They are skipped unless the repository
variable `SANDBOX_DEPLOY_ROLE_ARN` (and `AWS_REGION`) is set.

## How the actions are resolved

The reusable workflows use the composite actions in this repository. Because `uses: ./...` inside a
reusable workflow resolves against the _caller's_ checkout, each job checks out the repository and
commit the workflow itself runs from (`job.workflow_repository` @ `job.workflow_sha`) into
`.platform-cdk` and references the actions from there. Workflows and actions are therefore always
the same version. The `checks` job removes that directory again before linting so repository-wide
linters do not see it.

## Caller workflows for a service repository

Copy these three files into `.github/workflows/` of the service (the scaffolder generates them).

### `checks.yml`

```yaml
name: Checks

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write
  pull-requests: write

jobs:
  checks:
    uses: rpallas/platform-cdk/.github/workflows/service-checks.yml@v1
    with:
      diff: true
      aws-region: ${{ vars.AWS_REGION }}
      readonly-role-arn: ${{ vars.AWS_READONLY_ROLE_ARN_DEV }}
    permissions:
      contents: read
      id-token: write
      pull-requests: write
```

### `preview.yml`

```yaml
name: Preview

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

permissions:
  contents: read
  id-token: write
  pull-requests: write

jobs:
  deploy:
    if: github.event.action != 'closed'
    uses: rpallas/platform-cdk/.github/workflows/service-preview-deploy.yml@v1
    with:
      aws-region: ${{ vars.AWS_REGION }}
      role-arn: ${{ vars.AWS_DEPLOY_ROLE_ARN_DEV }}
      integration-test-command: npm run test:integration
    permissions:
      contents: read
      id-token: write
      pull-requests: write

  destroy:
    if: github.event.action == 'closed'
    uses: rpallas/platform-cdk/.github/workflows/service-preview-destroy.yml@v1
    with:
      aws-region: ${{ vars.AWS_REGION }}
      role-arn: ${{ vars.AWS_DEPLOY_ROLE_ARN_DEV }}
    permissions:
      contents: read
      id-token: write
      pull-requests: write
```

### `deploy.yml`

```yaml
name: Deploy

on:
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write

jobs:
  deploy:
    uses: rpallas/platform-cdk/.github/workflows/service-deploy.yml@v1
    with:
      environments: dev,stage,prod
      aws-region: ${{ vars.AWS_REGION }}
      smoke-test-command: npm run test:smoke --if-present
    permissions:
      contents: read
      id-token: write
```

`vars` are resolved in the calling repository, so `AWS_DEPLOY_ROLE_ARN_DEV`, `_STAGE` and `_PROD`
must exist there (or be passed through `role-arns`).

## Security notes

- OIDC only: roles must trust `token.actions.githubusercontent.com` with a `sub` condition scoped
  to your repository (and, for production, to the GitHub Environment).
- Permissions are declared per job and are minimal; `pull-requests: write` is only granted where a
  comment is posted.
- All untrusted values (branch names, PR numbers, inputs) reach shell scripts through `env:`
  variables, never by interpolating `${{ }}` into `run:`.
- Dependencies are installed with `npm ci --ignore-scripts`.
