# PlatformTopic

SNS topic encrypted with the account platform key.

## Defaults

- `masterKey` = the account KMS key from `/platform/account/kms/key-arn`; `encryption: false` disables it, or pass an `IKey`
- Topic policy denies non-TLS publishes (`enforceSSL`)
- Name from the platform naming; `.fifo` suffix or `fifo: true` creates a FIFO topic

## Helpers

- `addLambdaSubscription(fn, options?)`
- `addQueueSubscription(queue, options?)` (raw message delivery by default)

## Alarms

`alarms.failedNotifications()`.

## Example

```ts
const notifications = new PlatformTopic(this, "Notifications");
notifications.addLambdaSubscription(worker);
notifications.addQueueSubscription(jobs);
```
