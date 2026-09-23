# examples/hello-http

The reference service for outcrop: an HTTP API backed by a Lambda function and a DynamoDB
table, with preview stacks per pull request. It is the output of

```sh
npx @rpallas/outcrop-cli create service hello-http --http-api --dynamodb \
  --project "Example Platform" --owner example-org
```

with the per-repository tooling (`package.json`, `tsconfig.json`, `jest.config.js`, ESLint,
workflows) replaced by this monorepo's shared configuration. The CLI test-suite asserts that the
generated files stay identical to the checked-in example, so the example is also the golden output
of the scaffolder.

This repository's CI deploys the example to a sandbox account when the `SANDBOX_DEPLOY_ROLE_ARN`
repository variable is set (see `.github/workflows/examples-*.yml`): pull requests get an ephemeral
preview stack named after the ticket in the branch name, and merges to `main` deploy `HelloHttp-dev`.

## Layout

- `platform.config.ts` - environments, isolation, preview settings
- `infra/bin/app.ts`, `infra/lib/service-stack.ts` - CDK app and stack
- `infra/tests/` - CloudFormation snapshot tests (base and preview)
- `app/src/handlers/http.ts` - Lambda handler using `@rpallas/outcrop-runtime`
- `app/src/lib/items-repository.ts` - DynamoDB access
- `app/tests/unit` - handler unit tests with mocked AWS SDK clients
- `app/tests/integration` - smoke tests run against the deployed preview URL

## Commands

```sh
npm test -w examples/hello-http                       # unit + snapshot tests
npm run test:integration -w examples/hello-http       # requires PREVIEW_ApiBaseUrl
npx cdk synth -c env=dev                              # from this directory
npx cdk deploy -c env=dev -c preview=true -c previewId=abc-123
```
