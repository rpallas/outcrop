import { Duration } from "aws-cdk-lib";
import { ComparisonOperator, type IWidget, Stats } from "aws-cdk-lib/aws-cloudwatch";
import { Stream, StreamEncryption, StreamMode, type StreamProps } from "aws-cdk-lib/aws-kinesis";
import type { IKey } from "aws-cdk-lib/aws-kms";
import type { Construct } from "constructs";
import { PlatformAlarm } from "../alerting/alarm";
import { type DashboardContributor, metricWidgets } from "../alerting/service-dashboard";
import { PlatformStack } from "../core/platform-stack";
import { kebab } from "../util/kebab";
import type { FunctionAlarmOptions } from "./function";

export interface PlatformStreamProps extends Omit<
  StreamProps,
  "streamName" | "encryption" | "encryptionKey"
> {
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /**
   * Encrypt with a customer managed key instead of the Kinesis managed key.
   * Pass the account key from `stack.params.account.kmsKey()` to share it.
   */
  readonly encryptionKey?: IKey;
}

/**
 * Kinesis Data Stream in on-demand mode with server-side encryption, 24 hour
 * retention (7 days outside previews), platform naming and alarm helpers for
 * consumer lag and throttled writes.
 */
export class PlatformStream extends Stream implements DashboardContributor {
  readonly shortName: string;
  readonly alarms: {
    /** Alarm when the oldest unread record is older than `threshold` ms (default 5 minutes). */
    iteratorAge: (options?: FunctionAlarmOptions) => PlatformAlarm;
    /** Alarm when producers are throttled (`WriteProvisionedThroughputExceeded`). */
    writeThrottles: (options?: FunctionAlarmOptions) => PlatformAlarm;
    /** Alarm when consumers are throttled (`ReadProvisionedThroughputExceeded`). */
    readThrottles: (options?: FunctionAlarmOptions) => PlatformAlarm;
  };

  constructor(scope: Construct, id: string, props: PlatformStreamProps = {}) {
    const stack = PlatformStack.of(scope);
    const { name, encryptionKey, ...streamProps } = props;
    const shortName = name ?? kebab(id);

    super(scope, id, {
      streamMode: StreamMode.ON_DEMAND,
      retentionPeriod: stack.isPreview ? Duration.hours(24) : Duration.days(7),
      removalPolicy: stack.removalPolicy,
      ...streamProps,
      streamName: stack.naming.resource("kinesisStream", shortName),
      encryption: encryptionKey ? StreamEncryption.KMS : StreamEncryption.MANAGED,
      ...(encryptionKey ? { encryptionKey } : {}),
    });

    this.shortName = shortName;

    this.alarms = {
      iteratorAge: (options = {}) =>
        new PlatformAlarm(this, "IteratorAgeAlarm", {
          name: options.name ?? `${shortName}-iterator-age`,
          severity: options.severity ?? "medium",
          metric: this.metricGetRecordsIteratorAgeMilliseconds({
            period: Duration.minutes(5),
            statistic: Stats.MAXIMUM,
            ...options.metricOptions,
          }),
          threshold: options.threshold ?? Duration.minutes(5).toMilliseconds(),
          evaluationPeriods: options.evaluationPeriods ?? 3,
          comparisonOperator:
            options.comparisonOperator ?? ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
      writeThrottles: (options = {}) =>
        new PlatformAlarm(this, "WriteThrottlesAlarm", {
          name: options.name ?? `${shortName}-write-throttles`,
          severity: options.severity ?? "medium",
          metric: this.metricWriteProvisionedThroughputExceeded({
            period: Duration.minutes(5),
            statistic: Stats.SUM,
            ...options.metricOptions,
          }),
          threshold: options.threshold ?? 1,
          evaluationPeriods: options.evaluationPeriods ?? 1,
          comparisonOperator:
            options.comparisonOperator ?? ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        }),
      readThrottles: (options = {}) =>
        new PlatformAlarm(this, "ReadThrottlesAlarm", {
          name: options.name ?? `${shortName}-read-throttles`,
          severity: options.severity ?? "low",
          metric: this.metricReadProvisionedThroughputExceeded({
            period: Duration.minutes(5),
            statistic: Stats.SUM,
            ...options.metricOptions,
          }),
          threshold: options.threshold ?? 1,
          evaluationPeriods: options.evaluationPeriods ?? 3,
          comparisonOperator:
            options.comparisonOperator ?? ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        }),
    };
  }

  /** Widgets for `serviceDashboard`. */
  dashboardWidgets(): IWidget[] {
    return metricWidgets([
      {
        title: `Stream ${this.shortName}: records`,
        left: [this.metricIncomingRecords(), this.metricGetRecords()],
        right: [
          this.metricWriteProvisionedThroughputExceeded(),
          this.metricReadProvisionedThroughputExceeded(),
        ],
      },
      {
        title: `Stream ${this.shortName}: iterator age`,
        left: [this.metricGetRecordsIteratorAgeMilliseconds({ statistic: Stats.MAXIMUM })],
      },
    ]);
  }
}
