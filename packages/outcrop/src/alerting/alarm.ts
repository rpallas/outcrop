import { Tags } from "aws-cdk-lib";
import {
  Alarm,
  type AlarmProps,
  type ComparisonOperator,
  type IMetric,
  type MetricOptions,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import type { ITopic } from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";
import { PLATFORM_TAGS, PlatformStack } from "../core/platform-stack";
import type { AlertSeverity } from "./severity";

export interface PlatformAlarmProps extends Omit<AlarmProps, "alarmName"> {
  /** Short name; the full alarm name is derived through PlatformNaming. */
  readonly name: string;
  readonly severity: AlertSeverity;
  /** Also notify when the alarm returns to OK. Default true. */
  readonly notifyOnOk?: boolean;
  /** Explicit topic instead of the environment topic for the severity. */
  readonly topic?: ITopic;
}

/**
 * Options accepted by the `alarms.*()` helpers of every platform construct.
 * Everything is optional; the construct supplies sensible defaults.
 */
export interface PlatformAlarmOptions extends Partial<
  Omit<PlatformAlarmProps, "metric" | "name" | "severity">
> {
  readonly severity?: AlertSeverity;
  readonly name?: string;
  /** Options merged into the metric (period, statistic, ...). */
  readonly metricOptions?: MetricOptions;
}

/** Defaults a construct provides for one of its standard alarms. */
export interface StandardAlarmDefaults {
  readonly name: string;
  readonly severity: AlertSeverity;
  readonly metric: IMetric;
  readonly threshold: number;
  readonly evaluationPeriods: number;
  readonly comparisonOperator: ComparisonOperator;
}

/**
 * Create a `PlatformAlarm` from construct defaults and caller options. Used by
 * the `alarms.*()` helpers so every construct applies overrides the same way.
 */
export const standardAlarm = (
  scope: Construct,
  id: string,
  options: PlatformAlarmOptions,
  defaults: StandardAlarmDefaults,
): PlatformAlarm => {
  const {
    severity,
    name,
    metricOptions: _metricOptions,
    threshold,
    evaluationPeriods,
    comparisonOperator,
    ...rest
  } = options;
  return new PlatformAlarm(scope, id, {
    ...rest,
    name: name ?? defaults.name,
    severity: severity ?? defaults.severity,
    metric: defaults.metric,
    threshold: threshold ?? defaults.threshold,
    evaluationPeriods: evaluationPeriods ?? defaults.evaluationPeriods,
    comparisonOperator: comparisonOperator ?? defaults.comparisonOperator,
  });
};

/** Import the environment alert topic for a severity from the SSM contract. */
export const alertTopic = (scope: Construct, severity: AlertSeverity): ITopic =>
  PlatformStack.of(scope).alerts.topic(severity);

/**
 * CloudWatch alarm wired to the environment's alert topic for its severity,
 * tagged with `platform:severity`, named through `PlatformNaming` and silent in
 * preview stacks unless the stack opted in.
 */
export class PlatformAlarm extends Alarm {
  readonly severity: AlertSeverity;

  constructor(scope: Construct, id: string, props: PlatformAlarmProps) {
    const stack = PlatformStack.of(scope);
    const { name, severity, notifyOnOk, topic, ...alarmProps } = props;
    super(scope, id, {
      treatMissingData: TreatMissingData.NOT_BREACHING,
      ...alarmProps,
      alarmName: stack.naming.resource("cloudWatchAlarm", name),
      alarmDescription:
        alarmProps.alarmDescription ?? `[${severity}] ${stack.config.service}: ${name}`,
    });
    this.severity = severity;
    Tags.of(this).add(PLATFORM_TAGS.severity, severity);

    if (stack.alerts.enabled || topic) {
      const target = topic ?? stack.alerts.topic(severity);
      const action = new SnsAction(target);
      this.addAlarmAction(action);
      if (notifyOnOk ?? true) this.addOkAction(action);
    }
  }
}
