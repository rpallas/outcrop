import { Stack } from "aws-cdk-lib";
import { CfnAnalyzer } from "aws-cdk-lib/aws-accessanalyzer";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import type { BaselineModuleProps } from "./base";

export interface PasswordPolicy {
  readonly minimumLength?: number;
  readonly requireSymbols?: boolean;
  readonly requireNumbers?: boolean;
  readonly requireUppercase?: boolean;
  readonly requireLowercase?: boolean;
  readonly maxAgeDays?: number;
  readonly reusePrevention?: number;
}

export interface AccountSettingsProps extends BaselineModuleProps {
  /** IAM account alias, e.g. `my-platform-dev`. Defaults to `<project>-<env>`; `false` skips it. */
  readonly alias?: string | false;
  /** IAM password policy; `false` leaves the account policy untouched. */
  readonly passwordPolicy?: PasswordPolicy | false;
  /** Account-level S3 Block Public Access. Default true. */
  readonly s3BlockPublicAccess?: boolean;
  /** EBS encryption by default in this region. Default true. */
  readonly ebsEncryptionByDefault?: boolean;
  /** IAM Access Analyzer for the account. Default true. */
  readonly accessAnalyzer?: boolean;
}

const DEFAULT_PASSWORD_POLICY: Required<PasswordPolicy> = {
  minimumLength: 14,
  requireSymbols: true,
  requireNumbers: true,
  requireUppercase: true,
  requireLowercase: true,
  maxAgeDays: 90,
  reusePrevention: 24,
};

/**
 * Account-wide security settings that have no CloudFormation resource type:
 * IAM alias and password policy, S3 Block Public Access and EBS default
 * encryption via `AwsCustomResource`, plus an IAM Access Analyzer.
 */
export class AccountSettings extends Construct {
  constructor(scope: Construct, id: string, props: AccountSettingsProps) {
    super(scope, id);
    const { context } = props;
    const stack = Stack.of(this);

    const alias = props.alias ?? `${context.config.project}-${context.env}`;
    if (alias !== false) {
      new AwsCustomResource(this, "Alias", {
        resourceType: "Custom::IamAccountAlias",
        onUpdate: {
          service: "IAM",
          action: "createAccountAlias",
          parameters: { AccountAlias: alias },
          physicalResourceId: PhysicalResourceId.of(alias),
        },
        onDelete: {
          service: "IAM",
          action: "deleteAccountAlias",
          parameters: { AccountAlias: alias },
        },
        policy: AwsCustomResourcePolicy.fromSdkCalls({
          resources: AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
        installLatestAwsSdk: false,
      });
    }

    if (props.passwordPolicy !== false) {
      const policy = { ...DEFAULT_PASSWORD_POLICY, ...props.passwordPolicy };
      new AwsCustomResource(this, "PasswordPolicy", {
        resourceType: "Custom::IamPasswordPolicy",
        onUpdate: {
          service: "IAM",
          action: "updateAccountPasswordPolicy",
          parameters: {
            MinimumPasswordLength: policy.minimumLength,
            RequireSymbols: policy.requireSymbols,
            RequireNumbers: policy.requireNumbers,
            RequireUppercaseCharacters: policy.requireUppercase,
            RequireLowercaseCharacters: policy.requireLowercase,
            AllowUsersToChangePassword: true,
            MaxPasswordAge: policy.maxAgeDays,
            PasswordReusePrevention: policy.reusePrevention,
            HardExpiry: false,
          },
          physicalResourceId: PhysicalResourceId.of(`${stack.account}-password-policy`),
        },
        policy: AwsCustomResourcePolicy.fromSdkCalls({
          resources: AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
        installLatestAwsSdk: false,
      });
    }

    if (props.s3BlockPublicAccess !== false) {
      new AwsCustomResource(this, "S3BlockPublicAccess", {
        resourceType: "Custom::S3AccountPublicAccessBlock",
        onUpdate: {
          service: "S3Control",
          action: "putPublicAccessBlock",
          parameters: {
            AccountId: stack.account,
            PublicAccessBlockConfiguration: {
              BlockPublicAcls: true,
              IgnorePublicAcls: true,
              BlockPublicPolicy: true,
              RestrictPublicBuckets: true,
            },
          },
          physicalResourceId: PhysicalResourceId.of(`${stack.account}-s3-public-access-block`),
        },
        policy: AwsCustomResourcePolicy.fromSdkCalls({
          resources: AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
        installLatestAwsSdk: false,
      });
    }

    if (props.ebsEncryptionByDefault !== false) {
      new AwsCustomResource(this, "EbsEncryptionByDefault", {
        resourceType: "Custom::EbsEncryptionByDefault",
        onUpdate: {
          service: "EC2",
          action: "enableEbsEncryptionByDefault",
          physicalResourceId: PhysicalResourceId.of(
            `${stack.account}-${stack.region}-ebs-encryption`,
          ),
        },
        policy: AwsCustomResourcePolicy.fromSdkCalls({
          resources: AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
        installLatestAwsSdk: false,
      });
    }

    if (props.accessAnalyzer !== false) {
      new CfnAnalyzer(this, "AccessAnalyzer", {
        analyzerName: `${context.config.project}-${context.env}-external-access`,
        type: "ACCOUNT",
      });
    }
  }
}
