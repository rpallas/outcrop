---
name: add-platform-construct
description: Design and implement a new construct inside the @rpallas/outcrop library (or an extension package) following its conventions for naming, removal policies, preview awareness, alarms, tests, snapshots and cdk-nag. Use when contributing to outcrop itself or wrapping an AWS resource the library does not cover yet.
---

# Add a construct to outcrop

## Checklist

```
- [ ] Extend the CDK L2 (`class PlatformX extends X`) and accept `Omit<XProps, ...>` plus platform options
- [ ] Resolve the stack with `PlatformStack.of(this)`; never read context or env vars directly
- [ ] Physical name from `stack.naming.resource(ResourceKind.<Kind>, id)`; add a `ResourceKind` rule if the service has new limits
- [ ] `removalPolicy: stack.removalPolicy`, log retention `stack.logRetention`, no deletion protection in previews
- [ ] Encryption with `stack.params.account.kmsKey()` when the service supports CMKs, SSL enforced
- [ ] `readonly alarms = { ... }` helpers returning `PlatformAlarm`, `dashboardWidgets(): IWidget[]`
- [ ] Publish values other services need with `PlatformParameter` under `paths.service(service, key)`
- [ ] Export from `src/constructs/index.ts`; JSDoc on every exported symbol
- [ ] `test/<name>.test.ts` with `Template` assertions (props, defaults, preview behaviour, alarms)
- [ ] Add to `test/kitchen-sink.ts`; update the snapshot; keep cdk-nag AwsSolutions clean (suppress only with a justified reason)
- [ ] `docs/constructs/<name>.md` and a changeset (`.changeset/*.md`, `"@rpallas/outcrop": minor`)
```

## Reference implementations

Read `src/constructs/queue.ts` (small), `src/constructs/http-api.ts` (domain + Route 53 + outputs + authorizers) and `src/constructs/function.ts` (environment variables and alarm set) before writing a new construct.

## Rules

- TypeScript strict with `exactOptionalPropertyTypes`: spread optional props conditionally (`...(x ? { x } : {})`). No `any`; prefer types from `aws-cdk-lib`.
- Alarm math expressions may reference at most 10 metrics; compose with `MathExpression` when a resource has many operations.
- Use the platform env alert topics via `PlatformAlarm` (severity prop); do not create topics in service constructs.
- Custom resources: `PlatformCustomResource` with a handler under `src/constructs/handlers/` and one shared provider per stack.
- Tests run with `aws:cdk:bundling-stacks: []` so esbuild never runs; use `test/fixtures.ts` (`testStack`, `previewStack`).
- Verify with `npx jest packages/outcrop`, `npx eslint packages/outcrop`, `npx prettier --check .`.
