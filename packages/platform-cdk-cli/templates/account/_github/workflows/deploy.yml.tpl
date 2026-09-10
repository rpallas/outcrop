name: Deploy account baseline

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

concurrency:
  group: account-baseline-${{ github.repository }}
  cancel-in-progress: false

jobs:
  baseline:
    uses: rpallas/platform-cdk/.github/workflows/account-baseline-deploy.yml@v1
    with:
      environments: dev,prod
      aws-region: ${{ vars.AWS_REGION }}
      # The baseline creates the regular deploy roles, so it deploys with a bootstrap/administration
      # role that you create once by hand (see docs/guides/account-setup.md).
      role-arns: |
        dev=${{ vars.AWS_BASELINE_ROLE_ARN_DEV }}
        prod=${{ vars.AWS_BASELINE_ROLE_ARN_PROD }}
