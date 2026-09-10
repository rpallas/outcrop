# serviceDashboard

`serviceDashboard(stack, props?)` builds a `PlatformDashboard` for a whole stack.

- Walks `stack.node.findAll()` and adds one row per construct implementing `DashboardContributor` (`shortName` + `dashboardWidgets()`): functions, HTTP/REST/WebSocket APIs, queues, tables, buckets, topics, event buses and rules, schedules, state machines, distributions, web ACLs and email identities
- Adds a header (`# {service} ({env})` by default) and an alarm status row with every `PlatformAlarm` (`alarms: false` to skip)
- `filter` narrows the constructs; call it last in the stack constructor so every construct is in the tree

```ts
serviceDashboard(this, { name: "service" });
```

Custom constructs can join by implementing `DashboardContributor` and using `metricWidgets([...])` to size their row.
