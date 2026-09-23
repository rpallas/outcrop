# Contributing

Thanks for taking the time to contribute.

## Prerequisites

- Node.js 24 (`nvm use` reads `.nvmrc`), npm 10+
- An AWS account you can deploy to if you want to run the examples

## Getting started

```bash
npm ci
npm run build
npm test
npm run lint
```

`npm run build` uses TypeScript project references (`tsconfig.build.json`) so packages build in dependency order. Tests run against the built `dist/` output of sibling packages, so build before testing after changing a dependency.

## Repository layout

- `packages/outcrop` - core constructs (`PlatformApp`, `PlatformStack`, primitives, naming, SSM contract, alerting)
- `packages/outcrop-account` - account and organisation baseline constructs
- `packages/outcrop-runtime` - Lambda runtime helpers
- `packages/outcrop-cli` - scaffolding CLI and bundled agent skills
- `packages/outcrop-neon`, `packages/outcrop-chatops` - optional integrations
- `.github/workflows` - repository CI and reusable workflows consumed by services
- `examples/` - reference service and account baseline, deployed by CI
- `docs/` - conventions, guides and architecture decision records

## Rules that CI enforces

- No `any` in TypeScript; prefer types from `aws-cdk-lib`, `@types/aws-lambda` and other upstream packages over new ones.
- No organisation-specific values. `tools/denylist.test.ts` fails the build on real account ids, domains, organisation ids, emails or webhook URLs. Use `111111111111`, `example.com`, `o-example`, `user@example.com`.
- Every published package change needs a changeset (`npm run changeset`).
- Every construct ships with assertion tests; the kitchen-sink stack must stay `cdk-nag` clean or carry a documented suppression.

## Conventions

Read `docs/conventions/` before adding a construct:

- naming: every physical name goes through `PlatformNaming`
- ssm-contract: account and environment values are read through `PlatformParameters`
- preview-model: preview stacks are destructible and isolated by prefix and domain
- tagging: standard tags are applied by `PlatformStack`

## Pull requests

- Keep PRs focused; one construct or one workflow change per PR is ideal.
- Update the relevant docs page and add an ADR for any new cross-cutting convention.
