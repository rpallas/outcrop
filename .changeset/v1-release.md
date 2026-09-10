---
"@rpallas/platform-cdk": major
"@rpallas/platform-cdk-account": major
"@rpallas/platform-cdk-runtime": major
"@rpallas/platform-cdk-cli": major
"@rpallas/platform-cdk-neon": major
"@rpallas/platform-cdk-chatops": major
---

First stable release. The public API of every package, the SSM parameter contract (`/platform/...`), the preview model and the reusable workflow inputs are now covered by semantic versioning; breaking changes to any of them require a major version and an ADR.

Added in this release: `PlatformStream` (Kinesis Data Streams), `PlatformDeliveryStream` (Amazon Data Firehose) and `PlatformPythonFunction`, shared `createFunctionAlarms`/`functionDashboardWidgets` helpers, a VitePress documentation site with the TypeDoc API reference, a threat model and SCP compatibility notes, gitleaks in `service-checks`, and fork protection in `service-preview-deploy`.
