# PlatformStream

Kinesis Data Stream for high-throughput, ordered event ingestion.

## Defaults

- On-demand capacity mode (no shard management)
- Server-side encryption with the Kinesis managed key; pass `encryptionKey` for a customer managed key
- Retention 7 days, 24 hours in previews
- Removal policy from the environment (destroyed in previews and unprotected environments)
- Name from the platform naming (`ResourceKind.KinesisStream`)

## Alarms

- `alarms.iteratorAge()`: oldest unread record older than 5 minutes (medium)
- `alarms.writeThrottles()`: producers throttled (medium)
- `alarms.readThrottles()`: consumers throttled (low)

## Example

```ts
const clicks = new PlatformStream(this, "Clicks");
clicks.grantWrite(collector);
consumer.addEventSource(
  new KinesisEventSource(clicks, {
    startingPosition: StartingPosition.TRIM_HORIZON,
    batchSize: 100,
    bisectBatchOnError: true,
    retryAttempts: 3,
  }),
);
clicks.alarms.iteratorAge();
```

Pair with [PlatformDeliveryStream](delivery-stream.md) to archive the stream to S3.
