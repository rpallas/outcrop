---
name: create-platform-service
description: Scaffold and evolve a service built with @rpallas/outcrop (Lambda-first AWS CDK constructs with preview stacks per pull request). Use when creating a new service, adding an HTTP API, queue consumer, event subscriber, scheduled job, static site, DynamoDB table or Neon database to a outcrop service, or when the user mentions outcrop, PlatformStack or preview stacks.
---

# Create or extend a outcrop service

## Scaffold a new service

Run the CLI rather than writing files by hand; it generates infra, handlers, tests, workflows and docs that match the current library version.

```sh
npx @rpallas/outcrop-cli create service <name> [--http-api] [--queue-consumer] [--event-subscriber] \
  [--scheduled] [--static-site] [--dynamodb | --neon] [--auth none|jwt-auth0|jwt-cognito|api-key] \
  --project <project> --domain <apex-domain> --region <region> --owner <github-owner>
```

Then: `cd <name> && npm run lint && npm test && npm run synth`.

## Conventions the generated code follows

- One `PlatformStack` per service in `infra/lib/service-stack.ts`; `platform.config.ts` (`definePlatformConfig`) lists environments, `isolation` and preview settings. Never hardcode account ids, regions or domains in stacks; they come from the config and the SSM contract (`this.params`).
- Construct ids are short PascalCase nouns (`Table`, `Api`, `HttpHandler`); physical names are derived by `PlatformNaming` (`<previewId>-<service>-<name>` in previews). Do not pass `functionName`, `tableName` or `queueName` unless there is a hard requirement.
- Handlers live in `app/src/handlers/*.ts` and use `@rpallas/outcrop-runtime` (`withHttpHandler`, `withSqsHandler`, `withEventHandler`, `withHandler`, `getLogger`, `getConfig`, `getSecret`, `publishEvent`). Return `json(...)`, throw `notFound()`/`badRequest()`; never `console.log`.
- Infra references handlers with `lambdaEntry(path.join(__dirname, "..", "..", "app", "src", "handlers", "<name>"))`.
- Every construct gets alarms: `fn.addStandardAlarms()`, `api.alarms.serverErrors()`, `queue.alarms.dlqDepth()`, `table.alarms.throttles()`. Alarms are silent in previews by default.
- Tests: unit tests mock AWS SDK clients with `aws-sdk-client-mock`; `infra/tests/*.snapshot.test.ts` snapshot both the base and a preview stack; integration tests read `PREVIEW_ApiBaseUrl`.
- Preview stacks are destroyed when the PR closes; anything stateful must be safe to delete (`removalPolicy` is DESTROY in previews automatically).

## Adding a capability to an existing service

1. Add the construct to `service-stack.ts` using the matching Platform construct (`PlatformQueue`, `PlatformTable`, `PlatformEventRule`, `PlatformSchedule`, `PlatformStaticSite`, `PlatformTopic`, `PlatformStateMachine`, `PlatformSecret`, ...). Grant access with the L2 grant methods (`table.grantReadWriteData(fn)`).
2. Pass resource names to handlers through `environment` (`TABLE_NAME: table.tableName`) and read them with `requireEnv`.
3. Add the handler under `app/src/handlers/` with the runtime wrapper, and a unit test.
4. Run `npm run test:snapshot:update` after reviewing the template diff, then `npm run lint && npm test`.

## When something needs a value from another service or the account

- Shared config: `this.params.config("auth0-domain")` (deploy-time) or `this.params.lookup(this.params.paths.config("auth0-domain"), { defaultValue })` (synth-time).
- Shared secrets: `this.params.secret("neon-api-key")`.
- Another service's outputs: `this.params.value(this.params.paths.service("orders", "api-url"))`.
- Account resources (KMS key, VPC, hosted zone, certificates, alert topics, event bus) are exposed on `this.params.account.*` and `this.params.env.*`.

## Do not

- Add ECS/EC2/RDS; the platform is Lambda-only. Use Neon (`--neon`) for Postgres.
- Reference other observability vendors; CloudWatch alarms and dashboards are the model.
- Edit `.github/workflows/*.yml` to inline steps; they call the reusable workflows `rpallas/outcrop/.github/workflows/*.yml@v1` and take inputs instead.
