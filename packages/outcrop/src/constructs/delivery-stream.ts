import { Duration, Size } from "aws-cdk-lib";
import { ComparisonOperator, type IWidget, Stats } from "aws-cdk-lib/aws-cloudwatch";
import type { IStream } from "aws-cdk-lib/aws-kinesis";
import {
  Compression,
  DeliveryStream,
  type DeliveryStreamProps,
  EnableLogging,
  type IDestination,
  KinesisStreamSource,
  S3Bucket,
  type S3BucketProps,
  StreamEncryption,
} from "aws-cdk-lib/aws-kinesisfirehose";
import type { IKey } from "aws-cdk-lib/aws-kms";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import type { IBucket } from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { PlatformAlarm } from "../alerting/alarm";
import { type DashboardContributor, metricWidgets } from "../alerting/service-dashboard";
import { PlatformStack } from "../core/platform-stack";
import { kebab } from "../util/kebab";
import { PlatformBucket } from "./bucket";
import type { FunctionAlarmOptions } from "./function";

export interface PlatformDeliveryStreamS3Destination extends Omit<
  S3BucketProps,
  "loggingConfig" | "encryptionKey"
> {
  /** Existing bucket; default: a `PlatformBucket` named `{name}-delivery` is created. */
  readonly bucket?: IBucket;
}

export interface PlatformDeliveryStreamProps extends Omit<
  DeliveryStreamProps,
  "deliveryStreamName" | "destination" | "source" | "encryption"
> {
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /**
   * Destination. Default: an S3 bucket destination with GZIP compression,
   * 5 minute / 64 MiB buffering and date-partitioned prefixes.
   */
  readonly destination?: IDestination | PlatformDeliveryStreamS3Destination;
  /** Read from a Kinesis stream instead of direct PUT. */
  readonly source?: IStream;
  /**
   * Customer managed key for buffered data (default: AWS owned key) and for the
   * default destination bucket. Ignored for the stream itself when `source` is
   * set, because Firehose inherits the Kinesis stream's encryption.
   */
  readonly encryptionKey?: IKey;
}

const isDestination = (
  value: IDestination | PlatformDeliveryStreamS3Destination,
): value is IDestination => typeof (value as IDestination).bind === "function";

/**
 * Amazon Data Firehose delivery stream with error logging to a platform log
 * group, a default S3 destination created by `PlatformBucket`, optional
 * Kinesis source and alarms for delivery failures.
 */
export class PlatformDeliveryStream extends DeliveryStream implements DashboardContributor {
  readonly shortName: string;
  /** Bucket created for the default S3 destination, when applicable. */
  readonly bucket: IBucket | undefined;
  readonly alarms: {
    /** Alarm when `DeliveryToS3.Success` drops below `threshold` (default 1 = any failure). */
    deliveryFailures: (options?: FunctionAlarmOptions) => PlatformAlarm;
    /** Alarm when records wait longer than `threshold` seconds before delivery (default 15 minutes). */
    deliveryFreshness: (options?: FunctionAlarmOptions) => PlatformAlarm;
  };

  constructor(scope: Construct, id: string, props: PlatformDeliveryStreamProps = {}) {
    const stack = PlatformStack.of(scope);
    const { name, destination, source, encryptionKey, ...streamProps } = props;
    const shortName = name ?? kebab(id);
    const deliveryStreamName = stack.naming.resource("firehoseStream", shortName);

    const logGroup = new LogGroup(scope, `${id}LogGroup`, {
      logGroupName: stack.naming.resource(
        "logGroup",
        `/aws/kinesisfirehose/${deliveryStreamName}`,
        {
          bare: true,
        },
      ),
      retention: stack.logRetention,
      removalPolicy: stack.removalPolicy,
    });

    let bucket: IBucket | undefined;
    let resolvedDestination: IDestination;
    if (destination && isDestination(destination)) {
      resolvedDestination = destination;
    } else {
      const s3Props = destination ?? {};
      const { bucket: providedBucket, ...destinationProps } = s3Props;
      // Concrete `Bucket` is not assignable to `IBucket` under exactOptionalPropertyTypes.
      const target: IBucket =
        providedBucket ??
        (new PlatformBucket(scope, `${id}Bucket`, {
          name: `${shortName}-delivery`,
          ...(encryptionKey ? { encryptionKey } : {}),
        }) as IBucket);
      bucket = target;
      resolvedDestination = new S3Bucket(target, {
        compression: Compression.GZIP,
        bufferingInterval: Duration.minutes(5),
        bufferingSize: Size.mebibytes(64),
        dataOutputPrefix: "data/!{timestamp:yyyy/MM/dd}/",
        errorOutputPrefix: "errors/!{firehose:error-output-type}/!{timestamp:yyyy/MM/dd}/",
        ...destinationProps,
        loggingConfig: new EnableLogging(logGroup),
        ...(encryptionKey ? { encryptionKey } : {}),
      });
    }

    super(scope, id, {
      ...streamProps,
      deliveryStreamName,
      destination: resolvedDestination,
      // Firehose refuses server-side encryption when reading from a Kinesis
      // stream: the source stream's own encryption applies instead.
      ...(source
        ? { source: new KinesisStreamSource(source) }
        : {
            encryption: encryptionKey
              ? StreamEncryption.customerManagedKey(encryptionKey)
              : StreamEncryption.awsOwnedKey(),
          }),
    });

    this.shortName = shortName;
    this.bucket = bucket;

    this.alarms = {
      deliveryFailures: (options = {}) =>
        new PlatformAlarm(this, "DeliveryFailuresAlarm", {
          name: options.name ?? `${shortName}-delivery-failures`,
          severity: options.severity ?? "high",
          metric: this.metric("DeliveryToS3.Success", {
            period: Duration.minutes(5),
            statistic: Stats.MINIMUM,
            ...options.metricOptions,
          }),
          threshold: options.threshold ?? 1,
          evaluationPeriods: options.evaluationPeriods ?? 3,
          comparisonOperator: options.comparisonOperator ?? ComparisonOperator.LESS_THAN_THRESHOLD,
        }),
      deliveryFreshness: (options = {}) =>
        new PlatformAlarm(this, "DeliveryFreshnessAlarm", {
          name: options.name ?? `${shortName}-delivery-freshness`,
          severity: options.severity ?? "medium",
          metric: this.metric("DeliveryToS3.DataFreshness", {
            period: Duration.minutes(5),
            statistic: Stats.MAXIMUM,
            ...options.metricOptions,
          }),
          threshold: options.threshold ?? 900,
          evaluationPeriods: options.evaluationPeriods ?? 3,
          comparisonOperator:
            options.comparisonOperator ?? ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
    };
  }

  /** Widgets for `serviceDashboard`. */
  dashboardWidgets(): IWidget[] {
    return metricWidgets([
      {
        title: `Delivery stream ${this.shortName}: records`,
        left: [this.metricIncomingRecords(), this.metricIncomingBytes()],
        right: [this.metric("DeliveryToS3.Records", { statistic: Stats.SUM })],
      },
      {
        title: `Delivery stream ${this.shortName}: delivery`,
        left: [this.metric("DeliveryToS3.Success", { statistic: Stats.MINIMUM })],
        right: [this.metric("DeliveryToS3.DataFreshness", { statistic: Stats.MAXIMUM })],
      },
    ]);
  }
}
