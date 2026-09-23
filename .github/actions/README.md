# Composite actions

Building blocks used by the reusable workflows in `.github/workflows/`. Each action can also be
used on its own from a service repository. Authentication is GitHub OIDC only - no access keys.

| Action                                      | Description                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`setup-node-project`](setup-node-project/) | Node.js from `.nvmrc` (or input) with npm cache and `npm ci --ignore-scripts`.                    |
| [`aws-oidc-login`](aws-oidc-login/)         | Assume an IAM role via OIDC (`aws-actions/configure-aws-credentials@v4`); outputs the account id. |
| [`preview-id`](preview-id/)                 | Derive the preview id from the branch / PR (CLI with identical bash fallback).                    |
| [`cdk-deploy`](cdk-deploy/)                 | `cdk deploy` with `env` / preview context, outputs file + artifact, stack names.                  |
| [`cdk-destroy`](cdk-destroy/)               | `cdk destroy --force`, skipping gracefully when the stacks do not exist.                          |
| [`stack-outputs`](stack-outputs/)           | Export CloudFormation outputs as `<PREFIX><Key>` env vars / step outputs and a JSON blob.         |
| [`pr-preview-comment`](pr-preview-comment/) | Sticky PR comment with preview status, id, stacks, URL, run link and timestamp.                   |
| [`cdk-diff-comment`](cdk-diff-comment/)     | `cdk diff` posted as a collapsible sticky PR comment; never fails on differences.                 |

## Consumer example

A hand-rolled preview job using the actions directly (the `service-preview-deploy.yml` reusable
workflow does all of this for you):

```yaml
name: Preview
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  id-token: write
  pull-requests: write

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: rpallas/outcrop/.github/actions/setup-node-project@v1
      - id: preview
        uses: rpallas/outcrop/.github/actions/preview-id@v1
      - uses: rpallas/outcrop/.github/actions/aws-oidc-login@v1
        with:
          role-arn: ${{ vars.AWS_DEPLOY_ROLE_ARN_DEV }}
          aws-region: ${{ vars.AWS_REGION }}
      - id: deploy
        uses: rpallas/outcrop/.github/actions/cdk-deploy@v1
        with:
          env: dev
          preview: "true"
          preview-id: ${{ steps.preview.outputs.preview-id }}
      - id: outputs
        uses: rpallas/outcrop/.github/actions/stack-outputs@v1
        with:
          outputs-file: ${{ steps.deploy.outputs.outputs-file }}
          prefix: PREVIEW_
      - uses: rpallas/outcrop/.github/actions/pr-preview-comment@v1
        with:
          status: deployed
          preview-id: ${{ steps.preview.outputs.preview-id }}
          stack-names: ${{ steps.deploy.outputs.stack-names }}
          base-url: ${{ env.PREVIEW_ApiBaseUrl }}
```

## Conventions

- All inputs are strings; booleans are `"true"` / `"false"`.
- Inputs are passed to scripts through `env:` (never interpolated into `run:`), so untrusted values
  such as branch names cannot inject shell.
- Every action writes a short section to the job summary (`$GITHUB_STEP_SUMMARY`).
- Local development of this repository invokes the CLI with
  `cli-command: node packages/outcrop-cli/bin/outcrop.js`; consumers use the published
  `@rpallas/outcrop-cli` via `cli-version`.
