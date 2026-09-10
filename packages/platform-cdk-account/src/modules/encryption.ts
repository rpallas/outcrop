import { Stack } from "aws-cdk-lib";
import {
  AccountRootPrincipal,
  AnyPrincipal,
  ArnPrincipal,
  Effect,
  PolicyStatement,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { type IKey, Key, KeySpec, KeyUsage } from "aws-cdk-lib/aws-kms";
import { ResourceKind } from "@rpallas/platform-cdk";
import { Construct } from "constructs";
import { type BaselineModuleProps, baselineRemovalPolicy, output, publishParameter } from "./base";

export interface EncryptionProps extends BaselineModuleProps {
  /** Allow every principal in this AWS Organization to use the key (for cross-account SNS/SQS/S3). */
  readonly allowOrganizationId?: string;
  /** Additional principal ARNs allowed to use the key. */
  readonly allowedPrincipalArns?: string[];
  /** AWS services allowed to use the key via grants. Default: logs, sns, sqs, s3, secretsmanager, ssm, events, lambda, dynamodb, states, scheduler. */
  readonly servicePrincipals?: string[];
}

const DEFAULT_SERVICES = [
  "logs",
  "sns",
  "sqs",
  "s3",
  "secretsmanager",
  "ssm",
  "events",
  "lambda",
  "dynamodb",
  "states",
  "scheduler",
];

/**
 * The platform KMS key: symmetric, yearly rotation, alias `alias/platform-<env>`
 * and a key policy that lets the platform AWS services encrypt on behalf of the
 * account. Published to `/platform/account/kms/key-arn` and `key-id`.
 */
export class Encryption extends Construct {
  readonly key: IKey;

  constructor(scope: Construct, id: string, props: EncryptionProps) {
    super(scope, id);
    const { context } = props;
    const stack = Stack.of(this);

    const key = new Key(this, "Key", {
      alias: `alias/${context.naming.resource(ResourceKind.KmsAlias, "key")}`,
      description: `${context.config.project} platform key (${context.env})`,
      enableKeyRotation: true,
      keySpec: KeySpec.SYMMETRIC_DEFAULT,
      keyUsage: KeyUsage.ENCRYPT_DECRYPT,
      removalPolicy: baselineRemovalPolicy(context),
    });
    this.key = key;

    key.addToResourcePolicy(
      new PolicyStatement({
        sid: "AllowAccountAdministration",
        effect: Effect.ALLOW,
        principals: [new AccountRootPrincipal()],
        actions: ["kms:*"],
        resources: ["*"],
      }),
    );
    const services = props.servicePrincipals ?? DEFAULT_SERVICES;
    key.addToResourcePolicy(
      new PolicyStatement({
        sid: "AllowPlatformServices",
        effect: Effect.ALLOW,
        principals: services.map((s) => new ServicePrincipal(`${s}.amazonaws.com`)),
        actions: [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey",
          "kms:CreateGrant",
        ],
        resources: ["*"],
        conditions: { StringEquals: { "aws:SourceAccount": stack.account } },
      }),
    );
    // CloudWatch Logs uses the key from the region's service principal with an encryption context.
    key.addToResourcePolicy(
      new PolicyStatement({
        sid: "AllowCloudWatchLogs",
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal(`logs.${stack.region}.amazonaws.com`)],
        actions: [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey",
        ],
        resources: ["*"],
        conditions: {
          ArnLike: {
            "kms:EncryptionContext:aws:logs:arn": stack.formatArn({
              service: "logs",
              resource: "log-group",
              resourceName: "*",
            }),
          },
        },
      }),
    );
    if (props.allowOrganizationId !== undefined) {
      key.addToResourcePolicy(
        new PolicyStatement({
          sid: "AllowOrganization",
          effect: Effect.ALLOW,
          principals: [new AnyPrincipal()],
          actions: [
            "kms:Encrypt",
            "kms:Decrypt",
            "kms:ReEncrypt*",
            "kms:GenerateDataKey*",
            "kms:DescribeKey",
          ],
          resources: ["*"],
          conditions: { StringEquals: { "aws:PrincipalOrgID": props.allowOrganizationId } },
        }),
      );
    }
    if (props.allowedPrincipalArns && props.allowedPrincipalArns.length > 0) {
      key.addToResourcePolicy(
        new PolicyStatement({
          sid: "AllowPrincipals",
          effect: Effect.ALLOW,
          principals: props.allowedPrincipalArns.map((arn) => new ArnPrincipal(arn)),
          actions: [
            "kms:Encrypt",
            "kms:Decrypt",
            "kms:ReEncrypt*",
            "kms:GenerateDataKey*",
            "kms:DescribeKey",
          ],
          resources: ["*"],
        }),
      );
    }

    publishParameter(this, "KeyArnParam", context.paths.account.kmsKeyArn(), key.keyArn);
    publishParameter(this, "KeyIdParam", context.paths.account.kmsKeyId(), key.keyId);
    output(this, "PlatformKeyArn", key.keyArn);
  }
}
