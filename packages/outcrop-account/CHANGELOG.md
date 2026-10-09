# @rpallas/outcrop-account

## 1.0.3

### Patch Changes

- Updated dependencies []:
  - @rpallas/outcrop@1.0.3

## 1.0.2

### Patch Changes

- [#4](https://github.com/rpallas/outcrop/pull/4) [`a63950f`](https://github.com/rpallas/outcrop/commit/a63950f8224eac878091e47c37e460082cca334f) Thanks [@rpallas](https://github.com/rpallas)! - Fix two account baseline permission bugs:
  
  - `AccountSettings`: the S3 Block Public Access custom resource now grants `s3:PutAccountPublicAccessBlock`. It previously granted `s3:PutPublicAccessBlock`, which doesn't exist at account level, so the first deploy failed with AccessDenied.
  - `create account`: the scaffolded `checks.yml` now grants `id-token: write` and `pull-requests: write`, which the reusable `service-checks.yml` workflow requires. Without them the workflow failed with `startup_failure`.
- Updated dependencies []:
  - @rpallas/outcrop@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies []:
  - @rpallas/outcrop@1.0.1

## 1.0.0

### Major Changes

- [`53a1fe9`](https://github.com/rpallas/outcrop/commit/53a1fe9ea47fdc685166ee7bff4421e5f399a496) Thanks [@rpallas](https://github.com/rpallas)! - First stable release. The public API of every package, the SSM parameter contract (`/platform/...`), the preview model and the reusable workflow inputs are now covered by semantic versioning; breaking changes to any of them require a major version and an ADR.
  
  Added in this release: `PlatformStream` (Kinesis Data Streams), `PlatformDeliveryStream` (Amazon Data Firehose) and `PlatformPythonFunction`, shared `createFunctionAlarms`/`functionDashboardWidgets` helpers, a VitePress documentation site with the TypeDoc API reference, a threat model and SCP compatibility notes, gitleaks in `service-checks`, and fork protection in `service-preview-deploy`.

### Minor Changes

- [`aea404d`](https://github.com/rpallas/outcrop/commit/aea404d2962a8785af33cc5ada82b022689595e6) Thanks [@rpallas](https://github.com/rpallas)! - Account baseline: `defineAccountConfig`, `createAccountBaseline`, `AccountBaselineStack` and the modules GitHubOidc, AccountSettings, Dns/EdgeCertificate, Alerting, EventBusModule, Encryption, SharedParameters/SharedSecrets, Budgets, Security, Network and LogRetention. CLI `create account` scaffolds a baseline app.

### Patch Changes

- Updated dependencies [[`8104a7e`](https://github.com/rpallas/outcrop/commit/8104a7e81384bd75832d8d489fc2e5cbbad76bf4), [`53a1fe9`](https://github.com/rpallas/outcrop/commit/53a1fe9ea47fdc685166ee7bff4421e5f399a496)]:
  - @rpallas/outcrop@1.0.0
