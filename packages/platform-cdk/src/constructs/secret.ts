import type { SecretValue } from "aws-cdk-lib";
import type { IKey } from "aws-cdk-lib/aws-kms";
import { type ISecret, Secret, type SecretProps } from "aws-cdk-lib/aws-secretsmanager";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { PlatformStack } from "../core/platform-stack";
import { ResourceKind } from "../naming/resource-kind";

export interface PlatformSecretGenerate {
  /** Length of the generated value. Default 32. */
  readonly length?: number;
  /** Exclude punctuation characters. Default true. */
  readonly excludePunctuation?: boolean;
  /** JSON template; the generated value is inserted under `generateKey`. */
  readonly template?: Record<string, unknown>;
  /** Key in `template` that receives the generated value. Default `password`. */
  readonly generateKey?: string;
}

export interface PlatformSecretProps extends Omit<
  SecretProps,
  | "secretName"
  | "generateSecretString"
  | "secretStringValue"
  | "secretObjectValue"
  | "removalPolicy"
> {
  /** Secret name within the service; the full name is derived through the platform naming. */
  readonly name: string;
  /** Generate the initial value (default when neither `generate` nor `value` is set). */
  readonly generate?: PlatformSecretGenerate;
  /** Explicit initial value (for example from a CloudFormation parameter or another secret). */
  readonly value?: SecretValue;
  /** Encrypt with a customer managed key instead of the Secrets Manager default key. */
  readonly encryptionKey?: IKey;
  /**
   * Publish the secret ARN to `/platform/services/{service}/secrets/{name}/arn`
   * so other stacks and the runtime can resolve it. Default true.
   */
  readonly publishArn?: boolean;
}

/**
 * Secrets Manager secret with platform naming, a generated or explicit initial
 * value, the stack removal policy and its ARN published to the SSM contract.
 */
export class PlatformSecret extends Secret {
  /** Import a shared platform secret (`/platform/secrets/{name}/arn`) by contract name. */
  static fromPlatform(scope: Construct, name: string): ISecret {
    return PlatformStack.of(scope).params.secret(name);
  }

  readonly shortName: string;
  /** SSM parameter holding the ARN, when published. */
  readonly arnParameter: StringParameter | undefined;

  constructor(scope: Construct, id: string, props: PlatformSecretProps) {
    const stack = PlatformStack.of(scope);
    const { name, generate, value, encryptionKey, publishArn, ...secretProps } = props;
    if (generate && value) {
      throw new Error(`${scope.node.path}/${id}: pass either \`generate\` or \`value\`, not both`);
    }
    const generateOptions = value ? undefined : (generate ?? {});

    super(scope, id, {
      description: `${stack.config.service} ${name} (${stack.envName})`,
      ...secretProps,
      secretName: stack.naming.resource(ResourceKind.Secret, name),
      removalPolicy: stack.removalPolicy,
      ...(encryptionKey ? { encryptionKey } : {}),
      ...(value ? { secretStringValue: value } : {}),
      ...(generateOptions
        ? {
            generateSecretString: {
              passwordLength: generateOptions.length ?? 32,
              excludePunctuation: generateOptions.excludePunctuation ?? true,
              ...(generateOptions.template
                ? {
                    secretStringTemplate: JSON.stringify(generateOptions.template),
                    generateStringKey: generateOptions.generateKey ?? "password",
                  }
                : {}),
            },
          }
        : {}),
    });
    this.shortName = name;

    if (publishArn !== false) {
      this.arnParameter = new StringParameter(this, "ArnParameter", {
        parameterName: stack.params.paths.service(stack.naming.prefix("/"), `secrets/${name}/arn`),
        stringValue: this.secretArn,
        description: `ARN of the ${stack.config.service} ${name} secret`,
      });
    }
  }
}
