import { Duration } from "aws-cdk-lib";
import {
  ComparisonOperator,
  type IWidget,
  Metric,
  type MetricOptions,
  Stats,
} from "aws-cdk-lib/aws-cloudwatch";
import {
  type Archive,
  EventBus,
  type EventBusProps,
  type EventPattern,
  type IEventBus,
} from "aws-cdk-lib/aws-events";
import type { Grant, IGrantable } from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import { type PlatformAlarm, type PlatformAlarmOptions, standardAlarm } from "../alerting/alarm";
import { type DashboardContributor, metricWidgets } from "../alerting/service-dashboard";
import { PlatformStack } from "../core/platform-stack";
import { ResourceKind } from "../naming/resource-kind";
import { kebab } from "../util/kebab";

export interface PlatformEventBusArchive {
  /** How long archived events are kept. */
  readonly retention: Duration;
  /** Only archive events matching this pattern. Default: every event on the bus. */
  readonly eventPattern?: EventPattern;
}

export interface PlatformEventBusProps extends Omit<EventBusProps, "eventBusName"> {
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /** Archive events for replay. */
  readonly archive?: PlatformEventBusArchive;
}

/** Metric on a custom event bus (`AWS/Events` with the `EventBusName` dimension). */
export const eventBusMetric = (
  bus: Pick<IEventBus, "eventBusName">,
  metricName: string,
  options: MetricOptions = {},
): Metric =>
  new Metric({
    namespace: "AWS/Events",
    metricName,
    dimensionsMap: { EventBusName: bus.eventBusName },
    statistic: Stats.SUM,
    period: Duration.minutes(5),
    ...options,
  });

/**
 * Custom EventBridge bus with platform naming, an optional archive and a
 * failed-invocations alarm. Use `PlatformEventBus.fromPlatform` for the shared
 * environment bus published by the account baseline.
 */
export class PlatformEventBus extends EventBus implements DashboardContributor {
  /** The environment's shared event bus from the SSM contract. */
  static fromPlatform(scope: Construct): IEventBus {
    return PlatformStack.of(scope).params.env.eventBus();
  }

  readonly shortName: string;
  readonly eventArchive: Archive | undefined;
  readonly alarms: {
    /** Alarm when rule targets on this bus fail to be invoked. */
    failedInvocations: (options?: PlatformAlarmOptions) => PlatformAlarm;
  };

  constructor(scope: Construct, id: string, props: PlatformEventBusProps = {}) {
    const stack = PlatformStack.of(scope);
    const { name, archive, ...busProps } = props;
    const shortName = name ?? kebab(id);

    super(scope, id, {
      description: `${stack.config.service} ${shortName} (${stack.envName})`,
      ...busProps,
      eventBusName: stack.naming.resource(ResourceKind.EventBus, shortName),
    });
    this.shortName = shortName;
    this.applyRemovalPolicy(stack.removalPolicy);

    if (archive) {
      // Archive names are limited to 48 characters; CloudFormation generates one
      // from the logical id, which already carries the stack (and preview) prefix.
      this.eventArchive = this.archive("Archive", {
        description: `${stack.config.service} ${shortName} archive`,
        retention: archive.retention,
        eventPattern: archive.eventPattern ?? { account: [stack.account] },
      });
    }

    this.alarms = {
      failedInvocations: (options = {}) =>
        standardAlarm(this, "FailedInvocationsAlarm", options, {
          name: `${shortName}-failed-invocations`,
          severity: "high",
          metric: eventBusMetric(this, "FailedInvocations", options.metricOptions),
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        }),
    };
  }

  /** Allow the grantee to publish events to this bus. */
  grantPutEvents(grantee: IGrantable): Grant {
    return this.grantPutEventsTo(grantee);
  }

  /** Widgets for `serviceDashboard`. */
  dashboardWidgets(): IWidget[] {
    return metricWidgets([
      {
        title: `Bus ${this.shortName}: events`,
        left: [
          eventBusMetric(this, "MatchedEvents"),
          eventBusMetric(this, "Invocations"),
          eventBusMetric(this, "TriggeredRules"),
        ],
      },
      {
        title: `Bus ${this.shortName}: failures`,
        left: [eventBusMetric(this, "FailedInvocations"), eventBusMetric(this, "ThrottledRules")],
      },
    ]);
  }
}
