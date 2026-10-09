# @rpallas/outcrop-cli

## 1.1.0

### Minor Changes

- [#8](https://github.com/rpallas/outcrop/pull/8) [`b1e00d3`](https://github.com/rpallas/outcrop/commit/b1e00d3921041f3010e9e1e9c7728ad90ac4405e) Thanks [@rpallas](https://github.com/rpallas)! - Support GitHub's immutable OIDC subject claims.
  
  GitHub repositories created after 15 July 2026 present `repo:<owner>@<owner-id>/<repo>@<repo-id>:...` as the token subject, so deploy and read-only roles that trusted `repo:<owner>/<repo>:...` rejected them.
  
  - `@rpallas/outcrop-account`: `github` entries accept optional `ownerId` and `repoId`, which must be set together. When they're set, the repository's roles trust only the immutable subject. `oidcSubjectPrefix` is exported.
  - `@rpallas/outcrop-cli`: the new `outcrop oidc-subject <owner>/<repo>` command uses the GitHub CLI to print a repository's subject prefix and the ids to add to `account.config.ts`. `create service` mentions it in its next steps.

## 1.0.3

### Patch Changes

- [#6](https://github.com/rpallas/outcrop/pull/6) [`7caf18a`](https://github.com/rpallas/outcrop/commit/7caf18a643369cc502658b8ae1add74bce3e9c4f) Thanks [@rpallas](https://github.com/rpallas)! - Scaffolded projects now pass their own `npm run lint` straight after `create`:
  
  - `create account` installs `eslint`, `@eslint/js`, `typescript-eslint` and `eslint-config-prettier`. The scaffolded `lint` script and `eslint.config.mjs` use them, but they weren't installed, so lint failed with `eslint: not found`.
  - `create account` and `create service` format the files they write with the project's own Prettier after installing dependencies. Rendered templates and the generated service stack didn't match the scaffolded Prettier config.
  - The service templates no longer trip `@typescript-eslint/require-await` or `no-unnecessary-type-assertion`. The in-memory HTTP store now has the same async interface as the DynamoDB repository.

## 1.0.2

### Patch Changes

- [#4](https://github.com/rpallas/outcrop/pull/4) [`a63950f`](https://github.com/rpallas/outcrop/commit/a63950f8224eac878091e47c37e460082cca334f) Thanks [@rpallas](https://github.com/rpallas)! - Fix two account baseline permission bugs:
  
  - `AccountSettings`: the S3 Block Public Access custom resource now grants `s3:PutAccountPublicAccessBlock`. It previously granted `s3:PutPublicAccessBlock`, which doesn't exist at account level, so the first deploy failed with AccessDenied.
  - `create account`: the scaffolded `checks.yml` now grants `id-token: write` and `pull-requests: write`, which the reusable `service-checks.yml` workflow requires. Without them the workflow failed with `startup_failure`.

## 1.0.1

### Patch Changes

- [#2](https://github.com/rpallas/outcrop/pull/2) [`b660b7a`](https://github.com/rpallas/outcrop/commit/b660b7acd01423dc24fb0d82d075f036eab5f17a) Thanks [@rpallas](https://github.com/rpallas)! - `create account` and `create service` now install TypeScript 6.0. `typescript@latest` is 7, which ts-jest and typescript-eslint do not support yet, so `npm install` failed. Generated `tsconfig.json` files use `Node16` module resolution, because TypeScript 6 rejects `Node10`.

## 1.0.0

### Major Changes

- [`53a1fe9`](https://github.com/rpallas/outcrop/commit/53a1fe9ea47fdc685166ee7bff4421e5f399a496) Thanks [@rpallas](https://github.com/rpallas)! - First stable release. The public API of every package, the SSM parameter contract (`/platform/...`), the preview model and the reusable workflow inputs are now covered by semantic versioning; breaking changes to any of them require a major version and an ADR.
  
  Added in this release: `PlatformStream` (Kinesis Data Streams), `PlatformDeliveryStream` (Amazon Data Firehose) and `PlatformPythonFunction`, shared `createFunctionAlarms`/`functionDashboardWidgets` helpers, a VitePress documentation site with the TypeDoc API reference, a threat model and SCP compatibility notes, gitleaks in `service-checks`, and fork protection in `service-preview-deploy`.

### Minor Changes

- [`aea404d`](https://github.com/rpallas/outcrop/commit/aea404d2962a8785af33cc5ada82b022689595e6) Thanks [@rpallas](https://github.com/rpallas)! - Account baseline: `defineAccountConfig`, `createAccountBaseline`, `AccountBaselineStack` and the modules GitHubOidc, AccountSettings, Dns/EdgeCertificate, Alerting, EventBusModule, Encryption, SharedParameters/SharedSecrets, Budgets, Security, Network and LogRetention. CLI `create account` scaffolds a baseline app.
