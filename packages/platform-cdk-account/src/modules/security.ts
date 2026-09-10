import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { type CfnTrail, ReadWriteType, Trail } from "aws-cdk-lib/aws-cloudtrail";
import { CfnConfigurationRecorder, CfnDeliveryChannel } from "aws-cdk-lib/aws-config";
import { CfnDetector } from "aws-cdk-lib/aws-guardduty";
import { ManagedPolicy, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import type { IKey } from "aws-cdk-lib/aws-kms";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  type IBucket,
  ObjectOwnership,
} from "aws-cdk-lib/aws-s3";
import { CfnHub, CfnStandard } from "aws-cdk-lib/aws-securityhub";
import { ResourceKind } from "@rpallas/platform-cdk";
import { Construct } from "constructs";
import { type BaselineModuleProps, baselineRemovalPolicy, publishParameter } from "./base";

export interface SecurityProps extends BaselineModuleProps {
  /** Multi-region CloudTrail for management events with CloudWatch Logs delivery. Default true. */
  readonly cloudTrail?: boolean;
  /** AWS Config recorder for all supported resource types. Default true. */
  readonly config?: boolean;
  /** GuardDuty detector. Default true. Skip when GuardDuty is managed by the organisation. */
  readonly guardDuty?: boolean;
  /** Security Hub with the AWS Foundational Security Best Practices standard. Default true. */
  readonly securityHub?: boolean;
  /** Retention for the audit bucket objects. Default 365 days (protected environments: 7 years). */
  readonly auditRetention?: Duration;
  readonly kmsKey?: IKey;
}

/**
 * Opt-in detective controls: CloudTrail, AWS Config, GuardDuty and Security Hub.
 * Organisation-managed variants of these services should be preferred where an
 * AWS Organization exists; disable the corresponding flag in that case.
 */
export class Security extends Construct {
  readonly auditBucket?: IBucket;
  readonly trail?: Trail;

  constructor(scope: Construct, id: string, props: SecurityProps) {
    super(scope, id);
    const { context } = props;
    const stack = Stack.of(this);
    const removalPolicy = baselineRemovalPolicy(context);
    const needsBucket = props.cloudTrail !== false || props.config !== false;

    if (needsBucket) {
      // Cast: `Bucket` widens optional members with `undefined`, which exactOptionalPropertyTypes rejects.
      this.auditBucket = new Bucket(this, "AuditBucket", {
        bucketName: context.naming.resource(ResourceKind.S3Bucket, `audit-${stack.account}`),
        encryption: props.kmsKey ? BucketEncryption.KMS : BucketEncryption.S3_MANAGED,
        ...(props.kmsKey ? { encryptionKey: props.kmsKey, bucketKeyEnabled: true } : {}),
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
        enforceSSL: true,
        versioned: true,
        removalPolicy,
        autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
        lifecycleRules: [
          {
            id: "expire-audit-logs",
            expiration:
              props.auditRetention ??
              (context.environment.protected ? Duration.days(365 * 7) : Duration.days(365)),
            noncurrentVersionExpiration: Duration.days(30),
          },
        ],
      }) as IBucket;
      publishParameter(
        this,
        "AuditBucketParam",
        context.paths.account.cloudTrailBucketName(),
        this.auditBucket.bucketName,
      );
    }

    if (props.cloudTrail !== false && this.auditBucket) {
      const logGroup = new LogGroup(this, "TrailLogGroup", {
        logGroupName: `/${context.naming.resource(ResourceKind.LogGroup, "cloudtrail")}`,
        retention: RetentionDays.ONE_YEAR,
        removalPolicy,
      });
      this.trail = new Trail(this, "Trail", {
        trailName: context.naming.resource(ResourceKind.Generic, "trail"),
        bucket: this.auditBucket,
        s3KeyPrefix: "cloudtrail",
        isMultiRegionTrail: true,
        includeGlobalServiceEvents: true,
        enableFileValidation: true,
        sendToCloudWatchLogs: true,
        cloudWatchLogGroup: logGroup,
        managementEvents: ReadWriteType.ALL,
        ...(props.kmsKey ? { encryptionKey: props.kmsKey } : {}),
      });
      (this.trail.node.defaultChild as CfnTrail).addPropertyOverride("IsOrganizationTrail", false);
    }

    if (props.config !== false && this.auditBucket) {
      const role = new Role(this, "ConfigRole", {
        assumedBy: new ServicePrincipal("config.amazonaws.com"),
        managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("service-role/AWS_ConfigRole")],
      });
      this.auditBucket.grantReadWrite(role, "config/*");
      this.auditBucket.grantRead(role);
      const recorder = new CfnConfigurationRecorder(this, "Recorder", {
        name: "default",
        roleArn: role.roleArn,
        recordingGroup: {
          allSupported: true,
          includeGlobalResourceTypes: stack.region === "us-east-1",
        },
      });
      const channel = new CfnDeliveryChannel(this, "DeliveryChannel", {
        name: "default",
        s3BucketName: this.auditBucket.bucketName,
        s3KeyPrefix: "config",
        configSnapshotDeliveryProperties: { deliveryFrequency: "TwentyFour_Hours" },
      });
      channel.node.addDependency(recorder);
    }

    if (props.guardDuty !== false) {
      new CfnDetector(this, "GuardDuty", {
        enable: true,
        findingPublishingFrequency: "FIFTEEN_MINUTES",
        features: [
          { name: "S3_DATA_EVENTS", status: "ENABLED" },
          { name: "LAMBDA_NETWORK_LOGS", status: "ENABLED" },
        ],
      });
    }

    if (props.securityHub !== false) {
      const hub = new CfnHub(this, "SecurityHub", {
        enableDefaultStandards: false,
        controlFindingGenerator: "SECURITY_CONTROL",
      });
      const standard = new CfnStandard(this, "FoundationalStandard", {
        standardsArn: `arn:${stack.partition}:securityhub:${stack.region}::standards/aws-foundational-security-best-practices/v/1.0.0`,
      });
      standard.node.addDependency(hub);
    }
  }
}
