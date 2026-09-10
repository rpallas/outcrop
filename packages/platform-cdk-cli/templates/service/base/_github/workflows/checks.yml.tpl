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
      aws-region: ${{ vars.AWS_REGION }}
      readonly-role-arn: ${{ vars.AWS_READONLY_ROLE_ARN_DEV }}
      diff: ${{ github.event_name == 'pull_request' }}
