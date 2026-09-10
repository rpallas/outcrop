# PlatformEventBus

Custom EventBridge bus. Most services publish to the shared environment bus instead; use `PlatformEventBus.fromPlatform(scope)` to import it from the SSM contract.

## Defaults

- Name from the platform naming, removal policy from the stack
- Optional archive (`archive: { retention, eventPattern? }`) for replay

## Helpers

- `grantPutEvents(grantee)`
- `eventBusMetric(bus, metricName)` for custom widgets and alarms

## Alarms

`alarms.failedInvocations()`.

## Example

```ts
const bus = new PlatformEventBus(this, "Domain", { archive: { retention: Duration.days(30) } });
bus.grantPutEvents(handler);
const shared = PlatformEventBus.fromPlatform(this);
```
