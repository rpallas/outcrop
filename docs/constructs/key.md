# PlatformKey

Customer managed KMS key for services that need their own key (most use the account key via `params.account.kmsKey()`).

## Defaults

- Key rotation on, alias `alias/<platform name>`, removal policy from the stack

## Props highlights

| Prop                | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| `allowedPrincipals` | Principals granted encrypt/decrypt in the key policy   |
| `grantOrganization` | Organisation id; every principal in it may use the key |

## Example

```ts
const key = new PlatformKey(this, "DataKey", { grantOrganization: "o-example1234" });
new PlatformSecret(this, "Db", { name: "database", encryptionKey: key });
```
