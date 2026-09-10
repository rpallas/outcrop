# {{service}}

Built with [platform-cdk](https://github.com/rpallas/platform-cdk). Variants: {{variantList}}.

## Develop

```bash
npm ci
npm run lint
npm test
npm run synth
```

## Deploy

Pull requests deploy a preview stack (`<ticket>-{{Service}}`) to `dev` and destroy it on close. Merges to `main` promote through the environments listed in `.github/workflows/deploy.yml`.

Required repository variables: `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN_DEV`, `AWS_DEPLOY_ROLE_ARN_PROD`, optionally `AWS_READONLY_ROLE_ARN_DEV`.

## Layout

- `platform.config.ts` - environments, isolation, preview settings
- `infra/` - CDK app and stack
- `app/src/handlers/` - Lambda handlers using `@rpallas/platform-cdk-runtime`
- `app/tests/` - unit and integration tests; `infra/tests/` - CloudFormation snapshots
