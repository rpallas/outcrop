# Getting started

This guide takes you from nothing to a service with preview stacks in about thirty minutes, assuming you already have an AWS account and a GitHub repository.

## 1. Apply the account baseline

Follow `account-setup.md`. At the end you will have:

- a GitHub OIDC provider and deploy roles for your repository
- a hosted zone and wildcard certificates for `dev.example.com`
- alert topics, an event bus and a KMS key
- everything published to SSM under `/platform`

## 2. Create a service

```bash
npx @rpallas/platform-cdk-cli create service orders --http-api --dynamodb
cd orders
npm ci
npx cdk synth -c env=dev
npx cdk synth -c env=dev -c preview=true -c previewId=abc-123
```

`platform.config.ts` describes environments; edit `domain` and `region` to match your account.

## 3. Wire GitHub

Follow `github-setup.md` to add repository variables (`AWS_REGION`, `AWS_DEPLOY_ROLE_ARN_DEV`, ...) and environments (`dev`, `stage`, `prod`). The generated workflows in `.github/workflows` call the reusable workflows from this repository.

## 4. Open a pull request

Push a branch, open a PR, and watch the preview deploy. The sticky comment contains the URL. Close the PR and the stack is destroyed.
