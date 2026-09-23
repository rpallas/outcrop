# aws-oidc-login

Assumes an IAM role with the GitHub OIDC token using `aws-actions/configure-aws-credentials@v6`.
No access keys are ever used. The job needs `permissions: id-token: write`.

## Usage

```yaml
permissions:
  id-token: write
  contents: read
steps:
  - uses: rpallas/outcrop/.github/actions/aws-oidc-login@v1
    with:
      role-arn: ${{ vars.AWS_DEPLOY_ROLE_ARN_DEV }}
      aws-region: ${{ vars.AWS_REGION }}
```

| Input              | Default                        | Description             |
| ------------------ | ------------------------------ | ----------------------- |
| `role-arn`         | required                       | IAM role ARN to assume. |
| `aws-region`       | required                       | AWS region.             |
| `session-name`     | `outcrop-${{ github.run_id }}` | Role session name.      |
| `duration-seconds` | `3600`                         | Session duration.       |

| Output       | Description                              |
| ------------ | ---------------------------------------- |
| `account-id` | Account id of the assumed role (masked). |
