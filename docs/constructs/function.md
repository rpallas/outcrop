# PlatformFunction

`NodejsFunction` with the platform defaults for Lambda compute.

## Defaults

- ARM64, Node.js 24, 1024 MB, 10 s timeout, X-Ray active tracing
- Explicit log group `/aws/lambda/<function>` with the stack log retention and removal policy
- esbuild bundling: minified, source maps, CJS
- Environment: `POWERTOOLS_*`, `LOG_LEVEL` (`debug` in previews, `info` otherwise), `PLATFORM_*` (project, service, env, preview id, SSM root)

## Props highlights

| Prop              | Purpose                                                               |
| ----------------- | --------------------------------------------------------------------- |
| `name`            | Short name (default kebab-cased id) used for the function name        |
| `deadLetterQueue` | `true` creates `<name>-dlq`, or pass an `IQueue`                      |
| `logging`         | `level`, `format: "json"` (Lambda advanced logging), `telemetryLayer` |
| `insights`        | Enable Lambda Insights                                                |

## Alarms

`alarms.errors()`, `alarms.throttles()`, `alarms.duration()` (p99 vs 80% of timeout), `alarms.deadLetters()`; `addStandardAlarms()` creates all applicable ones.

## Example

```ts
const handler = new PlatformFunction(this, "Handler", {
  entry: lambdaEntry("app/src/handlers/orders"),
  deadLetterQueue: true,
  environment: { TABLE_NAME: table.tableName },
});
handler.addStandardAlarms();
```
