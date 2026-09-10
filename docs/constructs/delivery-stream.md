# PlatformDeliveryStream

Amazon Data Firehose delivery stream that lands records in S3 (or any Firehose destination).

## Defaults

- Destination: a `PlatformBucket` named `{name}-delivery` with GZIP compression, 5 minute / 64 MiB buffering and `data/yyyy/MM/dd/` and `errors/<type>/yyyy/MM/dd/` prefixes
- Error logging to a platform log group `/aws/kinesisfirehose/<stream>` with the environment retention
- Direct PUT source; pass `source: stream` to read from a `PlatformStream`
- AWS owned key for buffered data; `encryptionKey` switches to a customer managed key for the stream and the default bucket (ignored for the stream when a Kinesis source is set)

## Options

- `destination`: either an `IDestination` from `aws-cdk-lib/aws-kinesisfirehose` (HTTP endpoint, custom) or S3 options (`bucket`, `dataOutputPrefix`, `compression`, `bufferingInterval`, `processors`, ...)
- `source`: `IStream`

## Alarms

- `alarms.deliveryFailures()`: `DeliveryToS3.Success` below 1 for three periods (high)
- `alarms.deliveryFreshness()`: records older than 15 minutes before delivery (medium)

## Example

```ts
const clicks = new PlatformStream(this, "Clicks");
const archive = new PlatformDeliveryStream(this, "ClicksArchive", {
  source: clicks,
  destination: { dataOutputPrefix: "clicks/!{timestamp:yyyy/MM/dd}/" },
});
archive.alarms.deliveryFailures();

// Direct PUT from a function
const audit = new PlatformDeliveryStream(this, "Audit");
audit.grantPutRecords(apiHandler);
apiHandler.addEnvironment("AUDIT_STREAM_NAME", audit.deliveryStreamName);
```

Use `CloudWatch Logs subscription filters` with a delivery stream to forward logs to S3 or an external endpoint without a third-party agent.
