---
"@rpallas/outcrop": minor
---

Construct breadth: `PlatformTopic`, `PlatformEventBus`, `PlatformEventRule`, `PlatformSchedule` (EventBridge Scheduler), `PlatformStateMachine`, `PlatformDistribution`, `PlatformStaticSite`, `PlatformUserPool`, `PlatformKey`, `PlatformSecret`, `PlatformParameter`, `PlatformWebAcl`, `PlatformRestApi`, `PlatformWebSocketApi` and `PlatformEmailIdentity`, each with platform naming, removal policy, preview-aware defaults and `alarms.*()` helpers. `serviceDashboard(stack)` builds a CloudWatch dashboard from every platform construct in a stack; existing constructs gained `dashboardWidgets()`. `PlatformAlarmOptions`/`standardAlarm` are exported for custom alarm helpers.
