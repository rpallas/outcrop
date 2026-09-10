# PlatformSecret

Secrets Manager secret owned by the service.

## Defaults

- Name `<platform prefix>-<name>`, removal policy from the stack
- Generated value (32 characters, no punctuation) unless `generate` or `value` is given; `generate.template` + `generateKey` produce JSON secrets
- ARN published to `/platform/services/{service}/secrets/{name}/arn` (preview stacks use their own prefix); `publishArn: false` skips it

`PlatformSecret.fromPlatform(scope, name)` imports a shared secret from `/platform/secrets/{name}/arn`.

## Example

```ts
const apiKey = new PlatformSecret(this, "ApiKey", { name: "api-key", generate: { length: 40 } });
apiKey.grantRead(handler);
const auth0 = PlatformSecret.fromPlatform(this, "auth0-client");
```
