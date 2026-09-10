# ADR 0001: Monorepo with multiple npm packages

Status: accepted

## Context

The project delivers CDK constructs, account provisioning constructs, Lambda runtime helpers, a CLI and GitHub Actions workflows. Consumers use different subsets: a service repo needs constructs and runtime helpers; an account repo needs only the account package; CI only needs the workflows.

## Decision

One repository, npm workspaces, several packages under the `@rpallas` scope:

- `platform-cdk` (core), `platform-cdk-account`, `platform-cdk-runtime`, `platform-cdk-cli`, `platform-cdk-neon`, `platform-cdk-chatops`.
- All packages are versioned together (changesets `fixed` group) so a single version number describes a compatible set.
- Reusable workflows live in the same repo and are consumed by tag (`@v1`), moved on every release.
- `aws-cdk-lib` and `constructs` are peer dependencies of every CDK package.
- CommonJS output via `tsc` project references; the runtime package also ships ESM.

## Consequences

- Consumers install only what they need and never pull CDK into Lambda bundles.
- One release process, one changelog, one CI pipeline.
- Cross-package changes are atomic and tested together.
