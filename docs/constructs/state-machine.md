# PlatformStateMachine

Step Functions state machine with tracing and platform logging.

## Defaults

- Standard workflow, X-Ray tracing on (`tracing: false` to disable)
- Log group `/aws/vendedlogs/states/<name>` with the stack log retention; level `ALL` with execution data in previews, `ERROR` otherwise (`logLevel`, `includeExecutionData`)
- Name and removal policy from the stack

## Alarms

`alarms.failed()`, `alarms.timedOut()`, `alarms.throttled()`, `alarms.duration()` (p99 > 80% of `timeout`, or 5 minutes).

## Example

```ts
const flow = new PlatformStateMachine(this, "OrderFlow", {
  definitionBody: DefinitionBody.fromChainable(definition),
  timeout: Duration.minutes(5),
});
flow.alarms.failed();
```
