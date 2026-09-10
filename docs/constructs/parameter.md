# PlatformParameter

SSM parameter a service publishes about itself.

## Defaults

- Path `/platform/services/{service}/{key}` (preview stacks: `/platform/services/{previewId}/{service}/{key}`); `path` overrides it
- Standard tier, or advanced when the value exceeds 4 KB (`tier` overrides)

`PlatformParameter.serviceValue(scope, service, key)` reads another service's parameter at deploy time; `servicePath` returns the path.

## Example

```ts
new PlatformParameter(this, "ApiUrl", { key: "api-url", value: api.baseUrl });
const billingUrl = PlatformParameter.serviceValue(this, "billing", "api-url");
```
