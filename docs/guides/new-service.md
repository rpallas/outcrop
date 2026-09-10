# New service checklist

1. `npx @rpallas/platform-cdk-cli create service <name> [--http-api] [--queue-consumer] [--event-subscriber] [--scheduled] [--static-site] [--dynamodb|--neon] [--auth none|jwt-auth0|jwt-cognito|api-key]`
2. Review `platform.config.ts` and `docs/decisions.md`.
3. `npm ci && npm run lint && npm test && npx cdk synth -c env=dev`
4. Add repository variables and environments (see `github-setup.md`).
5. Open a pull request and confirm the preview deploys and the integration tests pass.
6. Merge; `service-deploy.yml` promotes through environments.

## Layout

```text
<name>/
  platform.config.ts
  cdk.json
  package.json          # workspaces: app, infra
  app/src/handlers/     # Lambda handlers using @rpallas/platform-cdk-runtime
  app/tests/unit/
  app/tests/integration/
  infra/bin/app.ts      # new PlatformApp({ config })
  infra/lib/service-stack.ts
  infra/tests/service-stack.snapshot.test.ts
  .github/workflows/{checks,preview,deploy}.yml
  docs/decisions.md
```
