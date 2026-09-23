# @rpallas/outcrop

## 1.0.0

### Major Changes

- [`53a1fe9`](https://github.com/rpallas/outcrop/commit/53a1fe9ea47fdc685166ee7bff4421e5f399a496) Thanks [@rpallas](https://github.com/rpallas)! - First stable release. The public API of every package, the SSM parameter contract (`/platform/...`), the preview model and the reusable workflow inputs are now covered by semantic versioning; breaking changes to any of them require a major version and an ADR.
  
  Added in this release: `PlatformStream` (Kinesis Data Streams), `PlatformDeliveryStream` (Amazon Data Firehose) and `PlatformPythonFunction`, shared `createFunctionAlarms`/`functionDashboardWidgets` helpers, a VitePress documentation site with the TypeDoc API reference, a threat model and SCP compatibility notes, gitleaks in `service-checks`, and fork protection in `service-preview-deploy`.

### Minor Changes

- [`8104a7e`](https://github.com/rpallas/outcrop/commit/8104a7e81384bd75832d8d489fc2e5cbbad76bf4) Thanks [@rpallas](https://github.com/rpallas)! - Construct breadth: `PlatformTopic`, `PlatformEventBus`, `PlatformEventRule`, `PlatformSchedule` (EventBridge Scheduler), `PlatformStateMachine`, `PlatformDistribution`, `PlatformStaticSite`, `PlatformUserPool`, `PlatformKey`, `PlatformSecret`, `PlatformParameter`, `PlatformWebAcl`, `PlatformRestApi`, `PlatformWebSocketApi` and `PlatformEmailIdentity`, each with platform naming, removal policy, preview-aware defaults and `alarms.*()` helpers. `serviceDashboard(stack)` builds a CloudWatch dashboard from every platform construct in a stack; existing constructs gained `dashboardWidgets()`. `PlatformAlarmOptions`/`standardAlarm` are exported for custom alarm helpers.
