# PlatformEventRule

EventBridge rule with shorthands for the platform event envelope.

## Defaults

- Attached to the environment platform bus unless `eventBus` is given
- `eventNames` map to `detail-type` (the runtime publishes `DetailType = event name`, `Source = service name`); `source` and `detailType` add to the pattern; `eventPattern` is merged
- Targets (`IFunction | IQueue | IStateMachine | ITopic`) are wired with the right EventBridge target class
- `deadLetterQueue: true` creates `<name>-dlq`; `retryAttempts` and `maxEventAge` apply to every target

## Alarms

`alarms.failedInvocations()`, `alarms.deadLetter()`.

## Example

```ts
new PlatformEventRule(this, "OnOrderEvents", {
  eventNames: ["order.created", "order.updated"],
  source: "checkout",
  targets: [worker, flow],
  deadLetterQueue: true,
}).alarms.failedInvocations();
```
