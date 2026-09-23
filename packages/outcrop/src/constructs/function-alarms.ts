import { Duration } from "aws-cdk-lib";
import { ComparisonOperator, type IWidget, Stats } from "aws-cdk-lib/aws-cloudwatch";
import type { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import { PlatformAlarm, type PlatformAlarmProps } from "../alerting/alarm";
import { metricWidgets } from "../alerting/service-dashboard";
import type { FunctionAlarmOptions } from "./function";

/** Alarm helpers shared by every platform Lambda construct. */
export interface FunctionAlarms {
  /** Alarm when any invocation errors within the period. */
  errors: (options?: FunctionAlarmOptions) => PlatformAlarm;
  /** Alarm when invocations are throttled. */
  throttles: (options?: FunctionAlarmOptions) => PlatformAlarm;
  /** Alarm when p99 duration approaches the timeout (default 80%). */
  duration: (
    options?: FunctionAlarmOptions & { thresholdPercentOfTimeout?: number },
  ) => PlatformAlarm;
  /** Alarm when messages land in the dead letter queue. */
  deadLetters: (options?: FunctionAlarmOptions) => PlatformAlarm;
}

export const stripAlarmOptions = (
  options: FunctionAlarmOptions,
): Partial<
  Omit<
    PlatformAlarmProps,
    "metric" | "name" | "severity" | "threshold" | "evaluationPeriods" | "comparisonOperator"
  >
> => {
  const {
    severity: _severity,
    name: _name,
    metricOptions: _metricOptions,
    threshold: _threshold,
    evaluationPeriods: _evaluationPeriods,
    comparisonOperator: _comparisonOperator,
    ...rest
  } = options;
  return rest;
};

/**
 * Build the standard alarm helpers for a Lambda function. Alarms are scoped
 * under the function so construct ids stay stable across runtimes.
 */
export const createFunctionAlarms = (
  fn: LambdaFunction,
  shortName: string,
  timeout: Duration,
  dlq: IQueue | undefined,
): FunctionAlarms => ({
  errors: (options = {}) =>
    new PlatformAlarm(fn, "ErrorsAlarm", {
      name: options.name ?? `${shortName}-errors`,
      severity: options.severity ?? "high",
      metric: fn.metricErrors({
        period: Duration.minutes(5),
        statistic: Stats.SUM,
        ...options.metricOptions,
      }),
      threshold: options.threshold ?? 1,
      evaluationPeriods: options.evaluationPeriods ?? 1,
      comparisonOperator:
        options.comparisonOperator ?? ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      ...stripAlarmOptions(options),
    }),
  throttles: (options = {}) =>
    new PlatformAlarm(fn, "ThrottlesAlarm", {
      name: options.name ?? `${shortName}-throttles`,
      severity: options.severity ?? "medium",
      metric: fn.metricThrottles({
        period: Duration.minutes(5),
        statistic: Stats.SUM,
        ...options.metricOptions,
      }),
      threshold: options.threshold ?? 1,
      evaluationPeriods: options.evaluationPeriods ?? 1,
      comparisonOperator:
        options.comparisonOperator ?? ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      ...stripAlarmOptions(options),
    }),
  duration: (options = {}) => {
    const percent = options.thresholdPercentOfTimeout ?? 80;
    const { thresholdPercentOfTimeout: _ignored, ...rest } = options;
    return new PlatformAlarm(fn, "DurationAlarm", {
      name: rest.name ?? `${shortName}-duration`,
      severity: rest.severity ?? "medium",
      metric: fn.metricDuration({
        period: Duration.minutes(5),
        statistic: Stats.percentile(99),
        ...rest.metricOptions,
      }),
      threshold: rest.threshold ?? Math.floor((timeout.toMilliseconds() * percent) / 100),
      evaluationPeriods: rest.evaluationPeriods ?? 3,
      comparisonOperator: rest.comparisonOperator ?? ComparisonOperator.GREATER_THAN_THRESHOLD,
      ...stripAlarmOptions(rest),
    });
  },
  deadLetters: (options = {}) => {
    if (!dlq) {
      throw new Error(`${fn.node.path}: deadLetters alarm requires deadLetterQueue`);
    }
    return new PlatformAlarm(fn, "DeadLettersAlarm", {
      name: options.name ?? `${shortName}-dead-letters`,
      severity: options.severity ?? "high",
      metric: dlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: Stats.MAXIMUM,
        ...options.metricOptions,
      }),
      threshold: options.threshold ?? 1,
      evaluationPeriods: options.evaluationPeriods ?? 1,
      comparisonOperator:
        options.comparisonOperator ?? ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      ...stripAlarmOptions(options),
    });
  },
});

/** Dashboard widgets shared by every platform Lambda construct. */
export const functionDashboardWidgets = (
  fn: LambdaFunction,
  shortName: string,
  dlq: IQueue | undefined,
): IWidget[] =>
  metricWidgets([
    {
      title: `Function ${shortName}: invocations`,
      left: [fn.metricInvocations()],
      right: [fn.metricErrors(), fn.metricThrottles()],
    },
    {
      title: `Function ${shortName}: duration`,
      left: [
        fn.metricDuration({ statistic: Stats.percentile(50) }),
        fn.metricDuration({ statistic: Stats.percentile(99) }),
      ],
    },
    {
      title: `Function ${shortName}: concurrency`,
      left: [fn.metric("ConcurrentExecutions", { statistic: Stats.MAXIMUM })],
      ...(dlq ? { right: [dlq.metricApproximateNumberOfMessagesVisible()] } : {}),
    },
  ]);
