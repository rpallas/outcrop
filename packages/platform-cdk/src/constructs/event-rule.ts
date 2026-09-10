import { Duration } from "aws-cdk-lib";
import {
  ComparisonOperator,
  type IWidget,
  Metric,
  type MetricOptions,
  Stats,
} from "aws-cdk-lib/aws-cloudwatch";
import {
  type EventBus,
  type EventPattern,
  type IEventBus,
  type IRuleTarget,
  Rule,
  type RuleProps,
} from "aws-cdk-lib/aws-events";
import {
  LambdaFunction,
  SfnStateMachine,
  SnsTopic,
  SqsQueue,
} from "aws-cdk-lib/aws-events-targets";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import type { ITopic } from "aws-cdk-lib/aws-sns";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import type { IStateMachine } from "aws-cdk-lib/aws-stepfunctions";
import type { Construct } from "constructs";
import { type PlatformAlarm, type PlatformAlarmOptions, standardAlarm } from "../alerting/alarm";
import { type DashboardContributor, metricWidgets } from "../alerting/service-dashboard";
import { PlatformStack } from "../core/platform-stack";
import { ResourceKind } from "../naming/resource-kind";
import { kebab } from "../util/kebab";
import { PlatformQueue } from "./queue";

/** Resources a `PlatformEventRule` can deliver events to. */
export type PlatformEventRuleTarget = IFunction | IQueue | IStateMachine | ITopic;

export interface PlatformEventRuleProps extends Omit<
  RuleProps,
  "ruleName" | "eventBus" | "eventPattern" | "targets" | "schedule"
> {
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /**
   * Platform event names to match. The runtime package publishes events with
   * `DetailType` set to the event name and `Source` set to the service name, so
   * this is shorthand for `detailType`.
   */
  readonly eventNames?: string[];
  /** Match one or more event sources (service names). */
  readonly source?: string | string[];
  /** Match detail types explicitly. */
  readonly detailType?: string[];
  /** Additional pattern fields merged with the shorthands above. */
  readonly eventPattern?: EventPattern;
  /** Bus to attach the rule to. Default: the environment platform bus from the SSM contract. */
  readonly eventBus?: IEventBus | EventBus;
  /** Targets; functions, queues, state machines and topics are wired automatically. */
  readonly targets: PlatformEventRuleTarget[];
  /** Dead letter queue for failed deliveries: `true` creates one, or pass an existing queue. */
  readonly deadLetterQueue?: boolean | IQueue;
  /** Retry attempts for failed deliveries. Default 185 (EventBridge default). */
  readonly retryAttempts?: number;
  /** Maximum age of an event before it is dropped or dead-lettered. Default 24 hours. */
  readonly maxEventAge?: Duration;
}

const isFunction = (target: PlatformEventRuleTarget): target is IFunction =>
  "functionArn" in target;
const isQueue = (target: PlatformEventRuleTarget): target is IQueue => "queueArn" in target;
const isStateMachine = (target: PlatformEventRuleTarget): target is IStateMachine =>
  "stateMachineArn" in target;

/**
 * EventBridge rule on the platform bus with shorthands for the runtime event
 * envelope, automatic target wiring, an optional dead letter queue and alarms.
 */
export class PlatformEventRule extends Rule implements DashboardContributor {
  readonly shortName: string;
  readonly bus: IEventBus;
  readonly dlq: IQueue | undefined;
  readonly alarms: {
    /** Alarm when target invocations fail. */
    failedInvocations: (options?: PlatformAlarmOptions) => PlatformAlarm;
    /** Alarm when events land in the dead letter queue. */
    deadLetter: (options?: PlatformAlarmOptions) => PlatformAlarm;
  };

  constructor(scope: Construct, id: string, props: PlatformEventRuleProps) {
    const stack = PlatformStack.of(scope);
    const {
      name,
      eventNames,
      source,
      detailType,
      eventPattern,
      eventBus,
      targets,
      deadLetterQueue,
      retryAttempts,
      maxEventAge,
      ...ruleProps
    } = props;
    const shortName = name ?? kebab(id);
    const bus = (eventBus as IEventBus | undefined) ?? stack.params.env.eventBus();

    const detailTypes = [...(eventNames ?? []), ...(detailType ?? [])];
    const sources = source === undefined ? [] : Array.isArray(source) ? source : [source];
    const pattern: EventPattern = {
      ...eventPattern,
      ...(detailTypes.length > 0
        ? { detailType: [...(eventPattern?.detailType ?? []), ...detailTypes] }
        : {}),
      ...(sources.length > 0 ? { source: [...(eventPattern?.source ?? []), ...sources] } : {}),
    };
    if (Object.keys(pattern).length === 0) {
      throw new Error(
        `${scope.node.path}/${id}: PlatformEventRule needs eventNames, source, detailType or an eventPattern`,
      );
    }

    let dlq: IQueue | undefined;
    if (deadLetterQueue === true) {
      dlq = new PlatformQueue(scope, `${id}Dlq`, {
        name: `${shortName}-dlq`,
        retentionPeriod: Duration.days(14),
      });
    } else if (deadLetterQueue) {
      dlq = deadLetterQueue;
    }

    const targetOptions = {
      ...(dlq ? { deadLetterQueue: dlq } : {}),
      ...(retryAttempts !== undefined ? { retryAttempts } : {}),
      ...(maxEventAge ? { maxEventAge } : {}),
    };

    super(scope, id, {
      description: `${stack.config.service} ${shortName} (${stack.envName})`,
      ...ruleProps,
      ruleName: stack.naming.resource(ResourceKind.EventRule, shortName),
      eventBus: bus,
      eventPattern: pattern,
      targets: targets.map((target): IRuleTarget => {
        if (isFunction(target)) return new LambdaFunction(target, targetOptions);
        if (isQueue(target)) return new SqsQueue(target, targetOptions);
        if (isStateMachine(target)) return new SfnStateMachine(target, targetOptions);
        return new SnsTopic(target, targetOptions);
      }),
    });
    this.shortName = shortName;
    this.bus = bus;
    this.dlq = dlq;

    this.alarms = {
      failedInvocations: (options = {}) =>
        standardAlarm(this, "FailedInvocationsAlarm", options, {
          name: `${shortName}-failed-invocations`,
          severity: "high",
          metric: this.metric("FailedInvocations", options.metricOptions),
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        }),
      deadLetter: (options = {}) => {
        if (!this.dlq) {
          throw new Error(`${this.node.path}: deadLetter alarm requires deadLetterQueue`);
        }
        return standardAlarm(this, "DeadLetterAlarm", options, {
          name: `${shortName}-dead-letter`,
          severity: "high",
          metric: this.dlq.metricApproximateNumberOfMessagesVisible({
            period: Duration.minutes(5),
            statistic: Stats.MAXIMUM,
            ...options.metricOptions,
          }),
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        });
      },
    };
  }

  /** `AWS/Events` metric for this rule (`Invocations`, `FailedInvocations`, `TriggeredRules`, ...). */
  metric(metricName: string, options: MetricOptions = {}): Metric {
    return new Metric({
      namespace: "AWS/Events",
      metricName,
      dimensionsMap: { RuleName: this.ruleName, EventBusName: this.bus.eventBusName },
      statistic: Stats.SUM,
      period: Duration.minutes(5),
      ...options,
    });
  }

  /** Widgets for `serviceDashboard`. */
  dashboardWidgets(): IWidget[] {
    return metricWidgets([
      {
        title: `Rule ${this.shortName}: invocations`,
        left: [this.metric("TriggeredRules"), this.metric("Invocations")],
      },
      {
        title: `Rule ${this.shortName}: failures`,
        left: [this.metric("FailedInvocations"), this.metric("ThrottledRules")],
        ...(this.dlq ? { right: [this.dlq.metricApproximateNumberOfMessagesVisible()] } : {}),
      },
    ]);
  }
}
