import { Duration } from "aws-cdk-lib";
import { ComparisonOperator, type IWidget, Stats } from "aws-cdk-lib/aws-cloudwatch";
import type { IKey } from "aws-cdk-lib/aws-kms";
import { type DeadLetterQueue, Queue, QueueEncryption, type QueueProps } from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";
import { PlatformAlarm } from "../alerting/alarm";
import { type DashboardContributor, metricWidgets } from "../alerting/service-dashboard";
import { PlatformStack } from "../core/platform-stack";
import { kebab } from "../util/kebab";
import type { FunctionAlarmOptions } from "./function";

export interface PlatformQueueProps extends Omit<
  QueueProps,
  "queueName" | "deadLetterQueue" | "encryption"
> {
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /**
   * Dead letter queue: `true` creates `{name}-dlq` with 3 receives, a number
   * sets `maxReceiveCount`, or pass an explicit configuration.
   */
  readonly deadLetterQueue?: boolean | number | DeadLetterQueue;
  /** Encrypt with a KMS key instead of SQS managed encryption. */
  readonly encryptionKey?: IKey;
}

/**
 * SQS queue with SSE, TLS enforced, platform naming and an optional dead
 * letter queue, plus helpers for the standard alarms.
 */
export class PlatformQueue extends Queue implements DashboardContributor {
  readonly shortName: string;
  readonly dlq: Queue | undefined;
  readonly alarms: {
    /** Alarm when the oldest message exceeds `threshold` seconds (default 15 minutes). */
    age: (options?: FunctionAlarmOptions) => PlatformAlarm;
    /** Alarm when the dead letter queue has messages. */
    dlqDepth: (options?: FunctionAlarmOptions) => PlatformAlarm;
    /** Alarm when the visible backlog exceeds `threshold` messages (default 1000). */
    depth: (options?: FunctionAlarmOptions) => PlatformAlarm;
  };

  constructor(scope: Construct, id: string, props: PlatformQueueProps = {}) {
    const stack = PlatformStack.of(scope);
    const { name, deadLetterQueue, encryptionKey, ...queueProps } = props;
    const shortName = name ?? kebab(id);
    const isFifo = queueProps.fifo === true || shortName.endsWith(".fifo");
    const baseName = shortName.replace(/\.fifo$/, "");
    const queueName = `${stack.naming.resource("sqsQueue", baseName)}${isFifo ? ".fifo" : ""}`;

    let dlq: Queue | undefined;
    let dlqConfig: DeadLetterQueue | undefined;
    if (deadLetterQueue === true || typeof deadLetterQueue === "number") {
      dlq = new Queue(scope, `${id}Dlq`, {
        queueName: `${stack.naming.resource("sqsQueue", `${baseName}-dlq`)}${isFifo ? ".fifo" : ""}`,
        ...(isFifo ? { fifo: true } : {}),
        encryption: encryptionKey ? QueueEncryption.KMS : QueueEncryption.SQS_MANAGED,
        ...(encryptionKey ? { encryptionMasterKey: encryptionKey } : {}),
        enforceSSL: true,
        retentionPeriod: Duration.days(14),
        removalPolicy: stack.removalPolicy,
      });
      dlqConfig = {
        queue: dlq,
        maxReceiveCount: typeof deadLetterQueue === "number" ? deadLetterQueue : 3,
      };
    } else if (deadLetterQueue) {
      dlqConfig = deadLetterQueue;
    }

    super(scope, id, {
      visibilityTimeout: Duration.seconds(60),
      retentionPeriod: Duration.days(4),
      removalPolicy: stack.removalPolicy,
      ...queueProps,
      ...(isFifo ? { fifo: true } : {}),
      queueName,
      encryption: encryptionKey ? QueueEncryption.KMS : QueueEncryption.SQS_MANAGED,
      ...(encryptionKey ? { encryptionMasterKey: encryptionKey } : {}),
      enforceSSL: true,
      ...(dlqConfig ? { deadLetterQueue: dlqConfig } : {}),
    });

    this.shortName = shortName;
    this.dlq = dlq;

    this.alarms = {
      age: (options = {}) =>
        new PlatformAlarm(this, "AgeAlarm", {
          name: options.name ?? `${baseName}-age`,
          severity: options.severity ?? "medium",
          metric: this.metricApproximateAgeOfOldestMessage({
            period: Duration.minutes(5),
            statistic: Stats.MAXIMUM,
            ...options.metricOptions,
          }),
          threshold: options.threshold ?? 900,
          evaluationPeriods: options.evaluationPeriods ?? 3,
          comparisonOperator:
            options.comparisonOperator ?? ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
      depth: (options = {}) =>
        new PlatformAlarm(this, "DepthAlarm", {
          name: options.name ?? `${baseName}-depth`,
          severity: options.severity ?? "medium",
          metric: this.metricApproximateNumberOfMessagesVisible({
            period: Duration.minutes(5),
            statistic: Stats.MAXIMUM,
            ...options.metricOptions,
          }),
          threshold: options.threshold ?? 1000,
          evaluationPeriods: options.evaluationPeriods ?? 3,
          comparisonOperator:
            options.comparisonOperator ?? ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
      dlqDepth: (options = {}) => {
        if (!this.dlq)
          throw new Error(`${this.node.path}: dlqDepth alarm requires deadLetterQueue`);
        return new PlatformAlarm(this, "DlqDepthAlarm", {
          name: options.name ?? `${baseName}-dlq-depth`,
          severity: options.severity ?? "high",
          metric: this.dlq.metricApproximateNumberOfMessagesVisible({
            period: Duration.minutes(5),
            statistic: Stats.MAXIMUM,
            ...options.metricOptions,
          }),
          threshold: options.threshold ?? 1,
          evaluationPeriods: options.evaluationPeriods ?? 1,
          comparisonOperator:
            options.comparisonOperator ?? ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        });
      },
    };
  }

  /** Widgets for `serviceDashboard`. */
  dashboardWidgets(): IWidget[] {
    return metricWidgets([
      {
        title: `Queue ${this.shortName}: messages`,
        left: [this.metricNumberOfMessagesSent(), this.metricNumberOfMessagesReceived()],
        right: [this.metricApproximateNumberOfMessagesVisible()],
      },
      {
        title: `Queue ${this.shortName}: age of oldest message`,
        left: [this.metricApproximateAgeOfOldestMessage()],
        ...(this.dlq ? { right: [this.dlq.metricApproximateNumberOfMessagesVisible()] } : {}),
      },
    ]);
  }
}
