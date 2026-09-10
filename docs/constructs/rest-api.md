# PlatformRestApi

API Gateway REST API for cases that need request validation, API keys, usage plans or WAF.

## Defaults

- Regional endpoint, one stage named after the environment (`dev`, `prod`), auto deploy
- JSON access logs in `/platform/apigateway/<api>`, X-Ray tracing, CloudWatch metrics, execution logs at `ERROR` (`INFO` in previews)
- 100 rps / 200 burst throttling
- Custom domain `{service}.{envDomain}` with TLS 1.2 and a Route 53 alias when the environment has a domain
- Outputs `<Name>BaseUrl`, `<Name>Id`, `<Name>DomainName` (the CDK `Endpoint` output is removed)

## Props highlights

| Prop           | Purpose                                                             |
| -------------- | ------------------------------------------------------------------- |
| `domain`       | `false` disables the custom domain, a string overrides the hostname |
| `throttle`     | `{ rateLimit, burstLimit }` or `false`                              |
| `loggingLevel` | `MethodLoggingLevel` override                                       |
| `webAcl`       | A REGIONAL `PlatformWebAcl` associated with the stage               |
| `stageOptions` | Extra `StageOptions` merged over the defaults                       |

Helpers: `addLambdaRoute(path, methods, fn, { apiKeyRequired, authorizer, requestValidator, ... })` creates intermediate resources; `addValidator(name, { body, parameters })`; `addApiKey(id)` (platform-named); `addUsagePlan({ throttle, quota, apiKeys })` bound to the stage.

## Alarms

`alarms.serverErrors()`, `alarms.clientErrors()`, `alarms.latency()`.

## Example

```ts
const admin = new PlatformRestApi(this, "Admin", { webAcl: firewall });
const validator = admin.addValidator("default");
admin.addLambdaRoute("/admin/orders/{id}", [HttpMethod.GET, HttpMethod.DELETE], handler, {
  authorizationType: AuthorizationType.IAM,
  requestValidator: validator,
  apiKeyRequired: true,
});
admin.addUsagePlan({
  throttle: { rateLimit: 10, burstLimit: 20 },
  apiKeys: [admin.addApiKey("Partner")],
});
```
