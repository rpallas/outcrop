import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { type IWidget, Metric, Stats } from "aws-cdk-lib/aws-cloudwatch";
import type { IKey } from "aws-cdk-lib/aws-kms";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  type BucketProps,
  EventType,
  type IBucket,
  type LifecycleRule,
  type NotificationKeyFilter,
  ObjectOwnership,
  StorageClass,
} from "aws-cdk-lib/aws-s3";
import {
  LambdaDestination,
  SnsDestination,
  SqsDestination,
} from "aws-cdk-lib/aws-s3-notifications";
import type { ITopic } from "aws-cdk-lib/aws-sns";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";
import { type DashboardContributor, metricWidgets } from "../alerting/service-dashboard";
import { PlatformStack } from "../core/platform-stack";
import { kebab } from "../util/kebab";

export interface PlatformBucketProps extends Omit<
  BucketProps,
  "bucketName" | "encryption" | "encryptionKey" | "blockPublicAccess" | "enforceSSL"
> {
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /** Use a customer managed KMS key instead of SSE-S3. */
  readonly encryptionKey?: IKey;
  /**
   * Expire objects after this many days (a simple lifecycle rule). Combine
   * with `lifecycleRules` for anything more specific.
   */
  readonly expireAfterDays?: number;
  /** Transition objects to Infrequent Access after this many days. */
  readonly infrequentAccessAfterDays?: number;
  /**
   * Bucket for server access logs. Pass `true` to use the account access logs
   * bucket from the SSM contract.
   */
  readonly accessLogs?: boolean | IBucket;
}

/**
 * S3 bucket with public access blocked, TLS enforced, encryption at rest,
 * bucket-owner enforced ownership, platform naming and removal policy, and
 * auto-deletion of objects in preview stacks.
 */
export class PlatformBucket extends Bucket implements DashboardContributor {
  readonly shortName: string;

  constructor(scope: Construct, id: string, props: PlatformBucketProps = {}) {
    const stack = PlatformStack.of(scope);
    const {
      name,
      encryptionKey,
      expireAfterDays,
      infrequentAccessAfterDays,
      accessLogs,
      ...bucketProps
    } = props;
    const shortName = name ?? kebab(id);
    const removalPolicy = bucketProps.removalPolicy ?? stack.removalPolicy;
    const autoDeleteObjects =
      bucketProps.autoDeleteObjects ?? removalPolicy === RemovalPolicy.DESTROY;

    const lifecycleRules: LifecycleRule[] = [...(bucketProps.lifecycleRules ?? [])];
    if (expireAfterDays !== undefined || infrequentAccessAfterDays !== undefined) {
      lifecycleRules.push({
        id: "platform-default",
        enabled: true,
        ...(expireAfterDays !== undefined ? { expiration: Duration.days(expireAfterDays) } : {}),
        ...(infrequentAccessAfterDays !== undefined
          ? {
              transitions: [
                {
                  storageClass: StorageClass.INFREQUENT_ACCESS,
                  transitionAfter: Duration.days(infrequentAccessAfterDays),
                },
              ],
            }
          : {}),
        abortIncompleteMultipartUploadAfter: Duration.days(7),
      });
    }

    let serverAccessLogsBucket: IBucket | undefined;
    if (accessLogs === true) {
      serverAccessLogsBucket = Bucket.fromBucketName(
        scope,
        `${id}AccessLogsBucket`,
        stack.params.account.accessLogsBucketName(),
      );
    } else if (accessLogs) {
      serverAccessLogsBucket = accessLogs;
    }

    super(scope, id, {
      versioned: false,
      ...bucketProps,
      bucketName: stack.naming.resource("s3Bucket", shortName),
      removalPolicy,
      autoDeleteObjects,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: bucketProps.objectOwnership ?? ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: encryptionKey ? BucketEncryption.KMS : BucketEncryption.S3_MANAGED,
      ...(encryptionKey ? { encryptionKey, bucketKeyEnabled: true } : {}),
      ...(lifecycleRules.length > 0 ? { lifecycleRules } : {}),
      ...(serverAccessLogsBucket
        ? {
            serverAccessLogsBucket,
            serverAccessLogsPrefix: bucketProps.serverAccessLogsPrefix ?? `${shortName}/`,
          }
        : {}),
    });

    this.shortName = shortName;
  }

  /** Invoke a function when objects are created (optionally filtered by prefix/suffix). */
  onObjectCreatedInvoke(fn: IFunction, ...filters: NotificationKeyFilter[]): this {
    this.addEventNotification(EventType.OBJECT_CREATED, new LambdaDestination(fn), ...filters);
    return this;
  }

  /** Send a message to a queue when objects are created. */
  onObjectCreatedEnqueue(queue: IQueue, ...filters: NotificationKeyFilter[]): this {
    this.addEventNotification(EventType.OBJECT_CREATED, new SqsDestination(queue), ...filters);
    return this;
  }

  /** Publish to a topic when objects are created. */
  onObjectCreatedPublish(topic: ITopic, ...filters: NotificationKeyFilter[]): this {
    this.addEventNotification(EventType.OBJECT_CREATED, new SnsDestination(topic), ...filters);
    return this;
  }

  /** Invoke a function when objects are removed. */
  onObjectRemovedInvoke(fn: IFunction, ...filters: NotificationKeyFilter[]): this {
    this.addEventNotification(EventType.OBJECT_REMOVED, new LambdaDestination(fn), ...filters);
    return this;
  }

  /** Daily storage metric (`BucketSizeBytes` or `NumberOfObjects`). */
  storageMetric(metricName: "BucketSizeBytes" | "NumberOfObjects"): Metric {
    return new Metric({
      namespace: "AWS/S3",
      metricName,
      dimensionsMap: {
        BucketName: this.bucketName,
        StorageType: metricName === "NumberOfObjects" ? "AllStorageTypes" : "StandardStorage",
      },
      statistic: Stats.AVERAGE,
      period: Duration.days(1),
    });
  }

  /** Widgets for `serviceDashboard`. */
  dashboardWidgets(): IWidget[] {
    return metricWidgets([
      { title: `Bucket ${this.shortName}: size`, left: [this.storageMetric("BucketSizeBytes")] },
      { title: `Bucket ${this.shortName}: objects`, left: [this.storageMetric("NumberOfObjects")] },
    ]);
  }
}
