# @rpallas/outcrop-cli

## 1.0.1

### Patch Changes

- [#2](https://github.com/rpallas/outcrop/pull/2) [`b660b7a`](https://github.com/rpallas/outcrop/commit/b660b7acd01423dc24fb0d82d075f036eab5f17a) Thanks [@rpallas](https://github.com/rpallas)! - `create account` and `create service` now install TypeScript 6.0. `typescript@latest` is 7, which ts-jest and typescript-eslint do not support yet, so `npm install` failed. Generated `tsconfig.json` files use `Node16` module resolution, because TypeScript 6 rejects `Node10`.

## 1.0.0

### Major Changes

- [`53a1fe9`](https://github.com/rpallas/outcrop/commit/53a1fe9ea47fdc685166ee7bff4421e5f399a496) Thanks [@rpallas](https://github.com/rpallas)! - First stable release. The public API of every package, the SSM parameter contract (`/platform/...`), the preview model and the reusable workflow inputs are now covered by semantic versioning; breaking changes to any of them require a major version and an ADR.
  
  Added in this release: `PlatformStream` (Kinesis Data Streams), `PlatformDeliveryStream` (Amazon Data Firehose) and `PlatformPythonFunction`, shared `createFunctionAlarms`/`functionDashboardWidgets` helpers, a VitePress documentation site with the TypeDoc API reference, a threat model and SCP compatibility notes, gitleaks in `service-checks`, and fork protection in `service-preview-deploy`.

### Minor Changes

- [`aea404d`](https://github.com/rpallas/outcrop/commit/aea404d2962a8785af33cc5ada82b022689595e6) Thanks [@rpallas](https://github.com/rpallas)! - Account baseline: `defineAccountConfig`, `createAccountBaseline`, `AccountBaselineStack` and the modules GitHubOidc, AccountSettings, Dns/EdgeCertificate, Alerting, EventBusModule, Encryption, SharedParameters/SharedSecrets, Budgets, Security, Network and LogRetention. CLI `create account` scaffolds a baseline app.
