# GitHub setup

## Repository variables

Set these under Settings, Secrets and variables, Actions, Variables:

- `AWS_REGION` - home region, e.g. `eu-west-1`
- `AWS_DEPLOY_ROLE_ARN_DEV` - from the account baseline outputs
- `AWS_DEPLOY_ROLE_ARN_STAGE`, `AWS_DEPLOY_ROLE_ARN_PROD` - one per environment you deploy to
- `AWS_READONLY_ROLE_ARN_DEV` - optional, enables `cdk diff` comments on pull requests

No secrets are needed: authentication is OIDC.

## Environments

Create GitHub Environments named after your platform environments (`dev`, `stage`, `prod`). Add required reviewers on `prod`. The `service-deploy.yml` reusable workflow binds each job to the matching environment, so approvals gate production.

## Caller workflows

The scaffolder generates three workflows. They are thin wrappers:

```yaml
# .github/workflows/preview.yml
on:
  pull_request:
    types: [opened, synchronize, reopened]
jobs:
  preview:
    uses: rpallas/platform-cdk/.github/workflows/service-preview-deploy.yml@v1
    with:
      aws-region: ${{ vars.AWS_REGION }}
      role-arn: ${{ vars.AWS_DEPLOY_ROLE_ARN_DEV }}
      integration-test-command: npm run test:integration
    permissions:
      id-token: write
      contents: read
      pull-requests: write
```

Pin to `@v1` for the floating major, or to a full tag for reproducibility.
