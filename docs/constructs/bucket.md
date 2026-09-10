# PlatformBucket

S3 bucket that is private by construction.

## Defaults

- Block all public access, `enforceSSL`, bucket-owner enforced ownership, SSE-S3 (or `encryptionKey`)
- Removal policy from the stack; objects are auto-deleted when the policy is `DESTROY`

## Props highlights

| Prop                                           | Purpose                                                      |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `expireAfterDays`, `infrequentAccessAfterDays` | Simple lifecycle rule                                        |
| `accessLogs`                                   | `true` uses the account access logs bucket, or pass a bucket |

Notification helpers: `onObjectCreatedInvoke`, `onObjectCreatedEnqueue`, `onObjectCreatedPublish`, `onObjectRemovedInvoke`.

## Example

```ts
const uploads = new PlatformBucket(this, "Uploads", { expireAfterDays: 30 });
uploads.onObjectCreatedEnqueue(jobs, { prefix: "incoming/" });
```
