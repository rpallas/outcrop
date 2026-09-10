# PlatformQueue

SQS queue with encryption, TLS and an optional dead letter queue.

## Defaults

- SQS managed encryption (or `encryptionKey`), `enforceSSL`, 60 s visibility timeout, 4 day retention
- FIFO when the name ends in `.fifo` or `fifo: true`

## Props highlights

| Prop              | Purpose                                                                  |
| ----------------- | ------------------------------------------------------------------------ |
| `deadLetterQueue` | `true` (3 receives), a number (`maxReceiveCount`) or a `DeadLetterQueue` |
| `encryptionKey`   | Customer managed key                                                     |

## Alarms

`alarms.age()` (oldest message > 15 min), `alarms.depth()` (> 1000 visible), `alarms.dlqDepth()`.

## Example

```ts
const jobs = new PlatformQueue(this, "Jobs", { deadLetterQueue: true });
jobs.alarms.dlqDepth();
```
