import { Duration } from "aws-cdk-lib";
import { ComparisonOperator, type IWidget, Stats } from "aws-cdk-lib/aws-cloudwatch";
import type { IKey } from "aws-cdk-lib/aws-kms";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { type ITopicSubscription, Topic, type TopicProps } from "aws-cdk-lib/aws-sns";
import {
  LambdaSubscription,
  type LambdaSubscriptionProps,
  SqsSubscription,
  type SqsSubscriptionProps,
} from "aws-cdk-lib/aws-sns-subscriptions";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";
import { type PlatformAlarm, type PlatformAlarmOptions, standardAlarm } from "../alerting/alarm";
import { type DashboardContributor, metricWidgets } from "../alerting/service-dashboard";
import { PlatformStack } from "../core/platform-stack";
import { ResourceKind } from "../naming/resource-kind";
import { kebab } from "../util/kebab";

export interface PlatformTopicProps extends Omit<
  TopicProps,
  "topicName" | "masterKey" | "enforceSSL"
> {
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /**
   * Encryption at rest. Default: the account platform KMS key from the SSM
   * contract. Pass a key to use a different one or `false` for no server-side
   * encryption (needed when a service without KMS permissions publishes).
   */
  readonly encryption?: boolean | IKey;
}

/**
 * SNS topic encrypted with the account platform key, TLS enforced through the
 * topic policy, platform naming and subscription helpers.
 */
export class PlatformTopic extends Topic implements DashboardContributor {
  readonly shortName: string;
  readonly alarms: {
    /** Alarm when SNS fails to deliver notifications to subscribers. */
    failedNotifications: (options?: PlatformAlarmOptions) => PlatformAlarm;
  };

  constructor(scope: Construct, id: string, props: PlatformTopicProps = {}) {
    const stack = PlatformStack.of(scope);
    const { name, encryption, ...topicProps } = props;
    const shortName = name ?? kebab(id);
    const isFifo = topicProps.fifo === true || shortName.endsWith(".fifo");
    const baseName = shortName.replace(/\.fifo$/, "");
    const masterKey =
      encryption === false
        ? undefined
        : encryption === undefined || encryption === true
          ? stack.params.account.kmsKey()
          : encryption;

    super(scope, id, {
      ...topicProps,
      topicName: `${stack.naming.resource(ResourceKind.SnsTopic, baseName)}${isFifo ? ".fifo" : ""}`,
      ...(isFifo ? { fifo: true } : {}),
      ...(masterKey ? { masterKey } : {}),
      enforceSSL: true,
    });
    this.shortName = shortName;

    this.alarms = {
      failedNotifications: (options = {}) =>
        standardAlarm(this, "FailedNotificationsAlarm", options, {
          name: `${baseName}-failed-notifications`,
          severity: "high",
          metric: this.metricNumberOfNotificationsFailed({
            period: Duration.minutes(5),
            statistic: Stats.SUM,
            ...options.metricOptions,
          }),
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        }),
    };
  }

  /** Subscribe a Lambda function. */
  addLambdaSubscription(fn: IFunction, options: LambdaSubscriptionProps = {}): ITopicSubscription {
    const subscription = new LambdaSubscription(fn, options);
    this.addSubscription(subscription);
    return subscription;
  }

  /** Subscribe an SQS queue (raw message delivery by default). */
  addQueueSubscription(queue: IQueue, options: SqsSubscriptionProps = {}): ITopicSubscription {
    const subscription = new SqsSubscription(queue, { rawMessageDelivery: true, ...options });
    this.addSubscription(subscription);
    return subscription;
  }

  /** Widgets for `serviceDashboard`. */
  dashboardWidgets(): IWidget[] {
    return metricWidgets([
      {
        title: `Topic ${this.shortName}: messages`,
        left: [this.metricNumberOfMessagesPublished(), this.metricNumberOfNotificationsDelivered()],
      },
      {
        title: `Topic ${this.shortName}: failures`,
        left: [this.metricNumberOfNotificationsFailed()],
      },
    ]);
  }
}
