# PlatformWebSocketApi

API Gateway WebSocket API with Lambda integrations.

## Defaults

- Stage named after the environment, auto deploy, detailed metrics, 100 rps / 200 burst throttling
- Access logs (connection id, route key, event type) in `/platform/apigateway/<api>`
- No custom domain unless `domain` is set: `true` uses `{service}-ws.{envDomain}` (preview pattern with `-ws`), a string sets the hostname
- Outputs `<Name>Url` (`wss://`) and `<Name>Id`

## Props highlights

| Prop                                                    | Purpose                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `connectHandler`, `disconnectHandler`, `defaultHandler` | Functions for the standard routes                                      |
| `connectAuthorizer`                                     | Authorizer for `$connect` (for example `new WebSocketIamAuthorizer()`) |
| `routes`                                                | `{ [routeKey]: IFunction }` custom routes                              |

`grantManageConnections(fn)` (inherited) allows posting to connections; `callbackUrl` is the `@connections` endpoint.

## Alarms

`alarms.serverErrors()` (integration + execution errors).

## Example

```ts
const ws = new PlatformWebSocketApi(this, "Realtime", {
  connectHandler: connect,
  connectAuthorizer: new WebSocketIamAuthorizer(),
  defaultHandler: message,
  routes: { subscribe: message },
});
ws.grantManageConnections(message);
```
