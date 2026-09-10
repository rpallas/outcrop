# PlatformUserPool

Cognito user pool with secure defaults.

## Defaults

- Email sign-in and auto verification, email required
- Password policy: 12+ characters, upper/lower/digits/symbols, 3 day temporary password validity
- MFA optional (TOTP), email-only account recovery, case-insensitive sign-in
- Self sign-up off (`selfSignUp: true` to allow)
- Essentials feature plan; `advancedSecurity: true` switches to Plus with full threat protection
- Deletion protection when the stack removal policy is `RETAIN`, removal policy from the stack otherwise

## Helpers

- `defaultClient`: lazily created SRP app client without OAuth
- `addHostedUiClient({ callbackUrls, logoutUrls, scopes, domainPrefix })`: authorization code client plus a Cognito hosted domain with a prefix from the platform naming
- Works with `PlatformHttpAuthorizers.cognito(userPool, { userPoolClients })`

## Alarms

`alarms.signInThrottles({ client? })`.

## Example

```ts
const users = new PlatformUserPool(this, "Users", { selfSignUp: false });
users.addHostedUiClient({ callbackUrls: [`${site.url}/callback`] });
api.addLambdaRoute("/me", HttpMethod.GET, handler, {
  authorizer: PlatformHttpAuthorizers.cognito(users, { userPoolClients: [users.defaultClient] }),
});
```
