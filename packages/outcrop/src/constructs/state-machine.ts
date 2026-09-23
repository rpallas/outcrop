import { Duration } from "aws-cdk-lib";
import {
  ComparisonOperator,
  type IWidget,
  type Metric,
  type MetricOptions,
  Stats,
} from "aws-cdk-lib/aws-cloudwatch";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import {
  LogLevel,
  StateMachine,
  type StateMachineProps,
  StateMachineType,
} from "aws-cdk-lib/aws-stepfunctions";
import type { Construct } from "constructs";
import { type PlatformAlarm, type PlatformAlarmOptions, standardAlarm } from "../alerting/alarm";
import { type DashboardContributor, metricWidgets } from "../alerting/service-dashboard";
import { PlatformStack } from "../core/platform-stack";
import { ResourceKind } from "../naming/resource-kind";
import { kebab } from "../util/kebab";

export interface PlatformStateMachineProps extends Omit<
  StateMachineProps,
  "stateMachineName" | "logs" | "tracingEnabled" | "removalPolicy"
> {
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /** Execution history log level. Default ALL in previews, ERROR otherwise. */
  readonly logLevel?: LogLevel;
  /** Include execution data (input/output) in the logs. Default: true in previews. */
  readonly includeExecutionData?: boolean;
  /** X-Ray tracing. Default true. */
  readonly tracing?: boolean;
}

/**
 * Step Functions state machine with X-Ray tracing, an explicit log group with
 * platform retention, platform naming and removal policy, and standard alarms.
 */
export class PlatformStateMachine extends StateMachine implements DashboardContributor {
  readonly shortName: string;
  readonly logGroup: LogGroup;
  readonly alarms: {
    /** Alarm when executions fail. */
    failed: (options?: PlatformAlarmOptions) => PlatformAlarm;
    /** Alarm when executions time out. */
    timedOut: (options?: PlatformAlarmOptions) => PlatformAlarm;
    /** Alarm when executions are throttled. */
    throttled: (options?: PlatformAlarmOptions) => PlatformAlarm;
    /** Alarm when p99 execution time exceeds `threshold` (milliseconds; default 80% of the timeout or 5 minutes). */
    duration: (options?: PlatformAlarmOptions) => PlatformAlarm;
  };

  constructor(scope: Construct, id: string, props: PlatformStateMachineProps) {
    const stack = PlatformStack.of(scope);
    const { name, logLevel, includeExecutionData, tracing, ...machineProps } = props;
    const shortName = name ?? kebab(id);
    const stateMachineName = stack.naming.resource(ResourceKind.StateMachine, shortName);

    const logGroup = new LogGroup(scope, `${id}LogGroup`, {
      logGroupName: stack.naming.resource(
        ResourceKind.LogGroup,
        `/aws/vendedlogs/states/${stateMachineName}`,
        { bare: true },
      ),
      retention: stack.logRetention,
      removalPolicy: stack.removalPolicy,
    });

    super(scope, id, {
      stateMachineType: StateMachineType.STANDARD,
      ...machineProps,
      stateMachineName,
      tracingEnabled: tracing ?? true,
      removalPolicy: stack.removalPolicy,
      logs: {
        destination: logGroup,
        level: logLevel ?? (stack.isPreview ? LogLevel.ALL : LogLevel.ERROR),
        includeExecutionData: includeExecutionData ?? stack.isPreview,
      },
    });
    this.shortName = shortName;
    this.logGroup = logGroup;

    const timeoutMs = machineProps.timeout?.toMilliseconds();
    const count = (metric: (o: MetricOptions) => Metric, options: PlatformAlarmOptions): Metric =>
      metric({
        period: Duration.minutes(5),
        statistic: Stats.SUM,
        ...options.metricOptions,
      });

    this.alarms = {
      failed: (options = {}) =>
        standardAlarm(this, "FailedAlarm", options, {
          name: `${shortName}-failed`,
          severity: "high",
          metric: count((o) => this.metricFailed(o), options),
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        }),
      timedOut: (options = {}) =>
        standardAlarm(this, "TimedOutAlarm", options, {
          name: `${shortName}-timed-out`,
          severity: "high",
          metric: count((o) => this.metricTimedOut(o), options),
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        }),
      throttled: (options = {}) =>
        standardAlarm(this, "ThrottledAlarm", options, {
          name: `${shortName}-throttled`,
          severity: "medium",
          metric: count((o) => this.metricThrottled(o), options),
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        }),
      duration: (options = {}) =>
        standardAlarm(this, "DurationAlarm", options, {
          name: `${shortName}-duration`,
          severity: "medium",
          metric: this.metricTime({
            period: Duration.minutes(5),
            statistic: Stats.percentile(99),
            ...options.metricOptions,
          }),
          threshold:
            timeoutMs !== undefined
              ? Math.floor(timeoutMs * 0.8)
              : Duration.minutes(5).toMilliseconds(),
          evaluationPeriods: 3,
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
    };
  }

  /** Widgets for `serviceDashboard`. */
  dashboardWidgets(): IWidget[] {
    return metricWidgets([
      {
        title: `State machine ${this.shortName}: executions`,
        left: [this.metricStarted(), this.metricSucceeded()],
        right: [this.metricFailed(), this.metricTimedOut(), this.metricAborted()],
      },
      {
        title: `State machine ${this.shortName}: duration`,
        left: [this.metricTime({ statistic: Stats.percentile(99) })],
      },
      {
        title: `State machine ${this.shortName}: throttles`,
        left: [this.metricThrottled()],
      },
    ]);
  }
}
