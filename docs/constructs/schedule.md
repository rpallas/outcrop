# PlatformSchedule

EventBridge Scheduler schedule. Each schedule gets its own schedule group so metrics and alarms are per schedule.

## Defaults

- `cron(...)`, `rate(...)` and `at(...)` strings are validated and parsed; `ScheduleExpression` is accepted as-is; `timezone` applies an IANA zone
- Targets: `IFunction` (`LambdaInvoke`), `IQueue` (`SqsSendMessage`), `IStateMachine` (`StepFunctionsStartExecution`)
- Disabled in preview stacks unless `runInPreview: true` (or `enabled` is set explicitly)
- Exact time window unless `flexibleTimeWindow` is given

## Props highlights

| Prop                           | Purpose                                            |
| ------------------------------ | -------------------------------------------------- |
| `input`                        | JSON object passed to the target                   |
| `deadLetterQueue`              | `true` creates one, or pass an `IQueue`            |
| `retryAttempts`, `maxEventAge` | Retry policy                                       |
| `scheduleGroup`                | Share an existing group instead of a dedicated one |

## Alarms

`alarms.failedInvocations()` (target errors for the schedule group).

## Example

```ts
new PlatformSchedule(this, "Nightly", {
  schedule: "cron(0 2 * * ? *)",
  timezone: "Europe/London",
  target: worker,
  input: { job: "cleanup" },
  deadLetterQueue: true,
});
```
