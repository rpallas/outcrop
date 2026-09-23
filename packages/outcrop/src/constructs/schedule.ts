import { Duration, TimeZone } from "aws-cdk-lib";
import { ComparisonOperator, type IWidget, Stats } from "aws-cdk-lib/aws-cloudwatch";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import {
  type IScheduleGroup,
  type IScheduleTarget,
  Schedule,
  ScheduleExpression,
  ScheduleGroup,
  type ScheduleProps,
  ScheduleTargetInput,
  TimeWindow,
} from "aws-cdk-lib/aws-scheduler";
import {
  LambdaInvoke,
  type ScheduleTargetBaseProps,
  SqsSendMessage,
  StepFunctionsStartExecution,
} from "aws-cdk-lib/aws-scheduler-targets";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import type { IStateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from "constructs";
import { type PlatformAlarm, type PlatformAlarmOptions, standardAlarm } from "../alerting/alarm";
import { type DashboardContributor, metricWidgets } from "../alerting/service-dashboard";
import { PlatformStack } from "../core/platform-stack";
import { ResourceKind } from "../naming/resource-kind";
import { kebab } from "../util/kebab";
import { PlatformQueue } from "./queue";

/** Resources a `PlatformSchedule` can invoke. */
export type PlatformScheduleTarget = IFunction | IQueue | IStateMachine;

export interface PlatformScheduleProps extends Omit<
  ScheduleProps,
  "schedule" | "target" | "scheduleName" | "enabled" | "timeWindow" | "scheduleGroup"
> {
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /**
   * Schedule expression: `cron(0 2 * * ? *)`, `rate(5 minutes)`, `at(2030-01-01T00:00:00)`
   * or a `ScheduleExpression`.
   */
  readonly schedule: string | ScheduleExpression;
  /** Function, queue or state machine to invoke. */
  readonly target: PlatformScheduleTarget;
  /** JSON input passed to the target. */
  readonly input?: Record<string, unknown>;
  /** IANA time zone for cron expressions, e.g. `Europe/London`. Default UTC. */
  readonly timezone?: string;
  /** Enable the schedule. Default true, except in previews (see `runInPreview`). */
  readonly enabled?: boolean;
  /** Run the schedule in preview stacks too. Default false: previews get a disabled schedule. */
  readonly runInPreview?: boolean;
  /** Invoke within a flexible window instead of exactly on time. */
  readonly flexibleTimeWindow?: Duration;
  /** Dead letter queue for failed invocations: `true` creates one, or pass an existing queue. */
  readonly deadLetterQueue?: boolean | IQueue;
  /** Retry attempts for failed invocations. Default 185 (Scheduler default). */
  readonly retryAttempts?: number;
  /** Maximum age of an invocation before it is dropped or dead-lettered. */
  readonly maxEventAge?: Duration;
  /** Put the schedule in an existing group instead of a dedicated one. */
  readonly scheduleGroup?: IScheduleGroup;
}

const EXPRESSION = /^(cron|rate|at)\(.+\)$/;

/** Parse a schedule expression string, applying an optional time zone. */
export const parseScheduleExpression = (
  expression: string | ScheduleExpression,
  timezone?: string,
): ScheduleExpression => {
  if (expression instanceof ScheduleExpression) return expression;
  const trimmed = expression.trim();
  if (!EXPRESSION.test(trimmed)) {
    throw new Error(
      `Invalid schedule expression "${expression}". Use "cron(<minutes> <hours> <day-of-month> <month> <day-of-week> <year>)", "rate(<value> <unit>)" or "at(<yyyy-mm-ddThh:mm:ss>)".`,
    );
  }
  return ScheduleExpression.expression(trimmed, timezone ? TimeZone.of(timezone) : undefined);
};

const isFunction = (target: PlatformScheduleTarget): target is IFunction => "functionArn" in target;
const isQueue = (target: PlatformScheduleTarget): target is IQueue => "queueArn" in target;

/**
 * EventBridge Scheduler schedule with platform naming, a dedicated schedule
 * group (so metrics and alarms are per schedule), optional dead letter queue
 * and preview-aware enablement.
 */
export class PlatformSchedule extends Construct implements DashboardContributor {
  readonly shortName: string;
  /** The underlying schedule. */
  readonly schedule: Schedule;
  /** Group the schedule belongs to; metrics are reported per group. */
  readonly group: IScheduleGroup;
  readonly dlq: IQueue | undefined;
  readonly enabled: boolean;
  readonly alarms: {
    /** Alarm when the target returns errors or invocations are dropped. */
    failedInvocations: (options?: PlatformAlarmOptions) => PlatformAlarm;
  };

  constructor(scope: Construct, id: string, props: PlatformScheduleProps) {
    super(scope, id);
    const stack = PlatformStack.of(scope);
    const {
      name,
      schedule,
      target,
      input,
      timezone,
      enabled,
      runInPreview,
      flexibleTimeWindow,
      deadLetterQueue,
      retryAttempts,
      maxEventAge,
      scheduleGroup,
      ...scheduleProps
    } = props;
    const shortName = name ?? kebab(id);
    this.shortName = shortName;
    this.enabled = enabled ?? (stack.isPreview ? runInPreview === true : true);

    if (deadLetterQueue === true) {
      this.dlq = new PlatformQueue(this, "Dlq", { name: `${shortName}-dlq` });
    } else if (deadLetterQueue) {
      this.dlq = deadLetterQueue;
    }

    this.group =
      scheduleGroup ??
      new ScheduleGroup(this, "Group", {
        scheduleGroupName: stack.naming.resource(ResourceKind.Schedule, shortName),
        removalPolicy: stack.removalPolicy,
      });

    const targetProps: ScheduleTargetBaseProps = {
      ...(input ? { input: ScheduleTargetInput.fromObject(input) } : {}),
      ...(this.dlq ? { deadLetterQueue: this.dlq } : {}),
      ...(retryAttempts !== undefined ? { retryAttempts } : {}),
      ...(maxEventAge ? { maxEventAge } : {}),
    };
    let scheduleTarget: IScheduleTarget;
    if (isFunction(target)) scheduleTarget = new LambdaInvoke(target, targetProps);
    else if (isQueue(target)) scheduleTarget = new SqsSendMessage(target, targetProps);
    else scheduleTarget = new StepFunctionsStartExecution(target, targetProps);

    this.schedule = new Schedule(this, "Schedule", {
      description: `${stack.config.service} ${shortName} (${stack.envName})`,
      ...scheduleProps,
      scheduleName: stack.naming.resource(ResourceKind.Schedule, shortName),
      schedule: parseScheduleExpression(schedule, timezone),
      target: scheduleTarget,
      scheduleGroup: this.group,
      enabled: this.enabled,
      timeWindow: flexibleTimeWindow ? TimeWindow.flexible(flexibleTimeWindow) : TimeWindow.off(),
    });

    this.alarms = {
      failedInvocations: (options = {}) =>
        standardAlarm(this, "FailedInvocationsAlarm", options, {
          name: `${shortName}-failed-invocations`,
          severity: "high",
          metric: this.group.metricTargetErrors({
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

  /** Widgets for `serviceDashboard`. */
  dashboardWidgets(): IWidget[] {
    return metricWidgets([
      {
        title: `Schedule ${this.shortName}: attempts`,
        left: [this.group.metricAttempts()],
      },
      {
        title: `Schedule ${this.shortName}: failures`,
        left: [
          this.group.metricTargetErrors(),
          this.group.metricDropped(),
          this.group.metricSentToDLQ(),
        ],
      },
    ]);
  }
}
