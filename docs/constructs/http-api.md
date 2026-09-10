# PlatformHttpApi

API Gateway HTTP API with access logs, throttling, optional CORS and a custom domain.

## Defaults

- `$default` stage with detailed metrics, 100 rps / 200 burst throttling and JSON access logs in `/platform/apigateway/<api>`
- Custom domain `{service}.{envDomain}` (preview pattern in previews) using the regional certificate and hosted zone from the SSM contract, plus a Route 53 alias
- Outputs `<Name>BaseUrl`, `<Name>Id`, `<Name>DomainName`

## Props highlights

| Prop                | Purpose                                                             |
| ------------------- | ------------------------------------------------------------------- |
| `domain`            | `false` disables the custom domain, a string overrides the hostname |
| `cors`              | `true` for permissive defaults or explicit `CorsPreflightOptions`   |
| `throttle`          | `{ rateLimit, burstLimit }` or `false`                              |
| `defaultAuthorizer` | Any `PlatformHttpAuthorizers.*` factory result                      |

`addLambdaRoute(path, methods, fn, options)` and `addLambdaProxy(fn, basePath)` create Lambda integrations; `urlFor(path)` builds URLs.

## Alarms

`alarms.serverErrors()`, `alarms.clientErrors()`, `alarms.latency()` (p99, 3000 ms).

## Example

```ts
const api = new PlatformHttpApi(this, "Api", {
  cors: true,
  defaultAuthorizer: PlatformHttpAuthorizers.auth0(
    "example.eu.auth0.com",
    "https://api.example.com",
  ),
});
api.addLambdaRoute("/orders", [HttpMethod.GET, HttpMethod.POST], handler);
```
