# PlatformCustomResource

Typed custom resource with one shared provider per handler.

## Defaults

- `PlatformCustomResource.handler(scope, id, props)` creates a `PlatformFunction` (5 minute timeout, 512 MB) with optional `policyStatements`
- One `Provider` per stack and handler pair, with a log group that follows the platform retention
- `resourceType` must start with `Custom::`; `properties` are typed by the generic parameter

## Example

```ts
const seedHandler = PlatformCustomResource.handler(this, "SeedHandler", {
  entry: lambdaEntry("infra/seed"),
});
new PlatformCustomResource<{ TableName: string }>(this, "Seed", {
  resourceType: "Custom::PlatformSeed",
  onEvent: seedHandler,
  properties: { TableName: table.tableName },
});
```
