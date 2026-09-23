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
    uses: rpallas/outcrop/.github/workflows/service-preview-deploy.yml@v1
    with:
      aws-region: ${{ vars.AWS_REGION }}
      role-arn: ${{ vars.AWS_DEPLOY_ROLE_ARN_DEV }}
      integration-test-command: npm run test:integration

  destroy:
    if: github.event.action == 'closed'
    uses: rpallas/outcrop/.github/workflows/service-preview-destroy.yml@v1
    with:
      aws-region: ${{ vars.AWS_REGION }}
      role-arn: ${{ vars.AWS_DEPLOY_ROLE_ARN_DEV }}
