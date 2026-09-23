name: Deploy

on:
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write

concurrency:
  group: deploy-${{ github.repository }}
  cancel-in-progress: false

jobs:
  deploy:
    uses: rpallas/outcrop/.github/workflows/service-deploy.yml@v1
    with:
      aws-region: ${{ vars.AWS_REGION }}
      environments: dev,prod
      role-arns: |
        dev=${{ vars.AWS_DEPLOY_ROLE_ARN_DEV }}
        prod=${{ vars.AWS_DEPLOY_ROLE_ARN_PROD }}
