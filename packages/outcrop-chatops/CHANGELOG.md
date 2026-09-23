# @rpallas/outcrop-chatops

## 1.0.0

### Major Changes

- [`53a1fe9`](https://github.com/rpallas/outcrop/commit/53a1fe9ea47fdc685166ee7bff4421e5f399a496) Thanks [@rpallas](https://github.com/rpallas)! - First stable release. The public API of every package, the SSM parameter contract (`/platform/...`), the preview model and the reusable workflow inputs are now covered by semantic versioning; breaking changes to any of them require a major version and an ADR.
  
  Added in this release: `PlatformStream` (Kinesis Data Streams), `PlatformDeliveryStream` (Amazon Data Firehose) and `PlatformPythonFunction`, shared `createFunctionAlarms`/`functionDashboardWidgets` helpers, a VitePress documentation site with the TypeDoc API reference, a threat model and SCP compatibility notes, gitleaks in `service-checks`, and fork protection in `service-preview-deploy`.

### Minor Changes

- [`8104a7e`](https://github.com/rpallas/outcrop/commit/8104a7e81384bd75832d8d489fc2e5cbbad76bf4) Thanks [@rpallas](https://github.com/rpallas)! - Integrations: `NeonBranch` creates a Neon Postgres branch per preview stack (custom resource, connection details written to a stack-owned Secrets Manager secret, branch deleted with the stack; base environments import the shared `neon-connection` secret). `ChatOpsNotifier` subscribes a Lambda function to the platform alert topics (or any topics) and delivers CloudWatch alarm, AWS Budgets, EventBridge and plain text notifications to Slack (Block Kit) and Microsoft Teams (Adaptive Card) incoming webhooks with severity filtering per destination.

### Patch Changes

- Updated dependencies [[`8104a7e`](https://github.com/rpallas/outcrop/commit/8104a7e81384bd75832d8d489fc2e5cbbad76bf4), [`53a1fe9`](https://github.com/rpallas/outcrop/commit/53a1fe9ea47fdc685166ee7bff4421e5f399a496)]:
  - @rpallas/outcrop@1.0.0
