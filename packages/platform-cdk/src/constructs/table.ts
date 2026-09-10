import { Duration } from "aws-cdk-lib";
import {
  ComparisonOperator,
  type IWidget,
  MathExpression,
  Stats,
} from "aws-cdk-lib/aws-cloudwatch";
import {
  type Attribute,
  Billing,
  Operation,
  type GlobalSecondaryIndexPropsV2,
  ProjectionType,
  StreamViewType,
  TableEncryptionV2,
  TableV2,
  type TablePropsV2,
} from "aws-cdk-lib/aws-dynamodb";
import type { IKey } from "aws-cdk-lib/aws-kms";
import type { Construct } from "constructs";
import { PlatformAlarm } from "../alerting/alarm";
import { type DashboardContributor, metricWidgets } from "../alerting/service-dashboard";
import { PlatformStack } from "../core/platform-stack";
import { kebab } from "../util/kebab";
import type { FunctionAlarmOptions } from "./function";

export interface PlatformTableProps extends Omit<
  TablePropsV2,
  "tableName" | "encryption" | "pointInTimeRecovery" | "pointInTimeRecoverySpecification"
> {
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /** Enable DynamoDB Streams with the given view type (`true` = NEW_AND_OLD_IMAGES). */
  readonly stream?: boolean | StreamViewType;
  /** Encrypt with a customer managed key instead of the DynamoDB owned key. */
  readonly encryptionKey?: IKey;
  /** Point-in-time recovery. Default: on, except in preview stacks. */
  readonly pointInTimeRecovery?: boolean;
}

/**
 * DynamoDB table: on-demand billing, point-in-time recovery outside previews,
 * platform removal policy and naming, GSI helper and throttle alarms.
 */
export class PlatformTable extends TableV2 implements DashboardContributor {
  readonly shortName: string;
  readonly alarms: {
    /** Alarm on throttled requests across all operations. */
    throttles: (options?: FunctionAlarmOptions) => PlatformAlarm;
    /** Alarm on system errors. */
    systemErrors: (options?: FunctionAlarmOptions) => PlatformAlarm;
  };

  constructor(scope: Construct, id: string, props: PlatformTableProps) {
    const stack = PlatformStack.of(scope);
    const { name, stream, encryptionKey, pointInTimeRecovery, ...tableProps } = props;
    const shortName = name ?? kebab(id);
    const pitr = pointInTimeRecovery ?? !stack.isPreview;

    super(scope, id, {
      billing: Billing.onDemand(),
      removalPolicy: stack.removalPolicy,
      deletionProtection: stack.context.environment.protected && !stack.isPreview,
      ...tableProps,
      tableName: stack.naming.resource("dynamoTable", shortName),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: pitr },
      encryption: encryptionKey
        ? TableEncryptionV2.customerManagedKey(encryptionKey)
        : TableEncryptionV2.dynamoOwnedKey(),
      ...(stream
        ? { dynamoStream: stream === true ? StreamViewType.NEW_AND_OLD_IMAGES : stream }
        : {}),
    });

    this.shortName = shortName;

    this.alarms = {
      throttles: (options = {}) =>
        new PlatformAlarm(this, "ThrottlesAlarm", {
          name: options.name ?? `${shortName}-throttles`,
          severity: options.severity ?? "medium",
          metric: new MathExpression({
            expression: "readThrottles + writeThrottles",
            label: "Throttle events",
            usingMetrics: {
              readThrottles: this.metric("ReadThrottleEvents", {
                period: Duration.minutes(5),
                statistic: Stats.SUM,
                ...options.metricOptions,
              }),
              writeThrottles: this.metric("WriteThrottleEvents", {
                period: Duration.minutes(5),
                statistic: Stats.SUM,
                ...options.metricOptions,
              }),
            },
            period: options.metricOptions?.period ?? Duration.minutes(5),
          }),
          threshold: options.threshold ?? 1,
          evaluationPeriods: options.evaluationPeriods ?? 1,
          comparisonOperator:
            options.comparisonOperator ?? ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        }),
      systemErrors: (options = {}) =>
        new PlatformAlarm(this, "SystemErrorsAlarm", {
          name: options.name ?? `${shortName}-system-errors`,
          severity: options.severity ?? "high",
          metric: this.metricSystemErrorsForOperations({
            operations: [
              Operation.GET_ITEM,
              Operation.PUT_ITEM,
              Operation.UPDATE_ITEM,
              Operation.DELETE_ITEM,
              Operation.QUERY,
              Operation.SCAN,
              Operation.BATCH_GET_ITEM,
              Operation.BATCH_WRITE_ITEM,
              Operation.TRANSACT_WRITE_ITEMS,
            ],
            period: Duration.minutes(5),
            statistic: Stats.SUM,
            ...options.metricOptions,
          }),
          threshold: options.threshold ?? 1,
          evaluationPeriods: options.evaluationPeriods ?? 1,
          comparisonOperator:
            options.comparisonOperator ?? ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        }),
    };
  }

  /**
   * Add a global secondary index named after its keys unless `indexName` is
   * given, projecting all attributes by default.
   */
  addGsi(
    props: Omit<GlobalSecondaryIndexPropsV2, "indexName" | "partitionKey"> & {
      indexName?: string;
      partitionKey: Attribute;
    },
  ): string {
    const indexName =
      props.indexName ??
      `${props.partitionKey.name}${props.sortKey ? `-${props.sortKey.name}` : ""}-index`;
    this.addGlobalSecondaryIndex({
      projectionType: ProjectionType.ALL,
      ...props,
      indexName,
    });
    return indexName;
  }

  /** Widgets for `serviceDashboard`. */
  dashboardWidgets(): IWidget[] {
    return metricWidgets([
      {
        title: `Table ${this.shortName}: capacity`,
        left: [this.metricConsumedReadCapacityUnits(), this.metricConsumedWriteCapacityUnits()],
      },
      {
        title: `Table ${this.shortName}: throttles`,
        left: [
          this.metric("ReadThrottleEvents", { statistic: Stats.SUM }),
          this.metric("WriteThrottleEvents", { statistic: Stats.SUM }),
        ],
      },
      {
        title: `Table ${this.shortName}: errors`,
        left: [this.metricUserErrors(), this.metricConditionalCheckFailedRequests()],
      },
    ]);
  }
}
