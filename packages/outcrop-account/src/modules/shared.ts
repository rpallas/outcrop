import type { IKey } from "aws-cdk-lib/aws-kms";
import { type ISecret, Secret } from "aws-cdk-lib/aws-secretsmanager";
import type { IParameter } from "aws-cdk-lib/aws-ssm";
import { ResourceKind } from "@rpallas/outcrop";
import { Construct } from "constructs";
import {
  type BaselineModuleProps,
  baselineRemovalPolicy,
  pascal,
  publishListParameter,
  publishParameter,
} from "./base";

export interface SharedParametersProps extends BaselineModuleProps {
  /** Plain configuration values published under `/platform/config/{key}`. */
  readonly values: Record<string, string | string[]>;
}

/**
 * Map-driven shared configuration (`/platform/config/{key}`) such as
 * `auth0-domain` or `neon-project-id`. Read at synth time with
 * `params.lookup(paths.config(key))` or at runtime with `getConfig(key)`.
 */
export class SharedParameters extends Construct {
  readonly parameters: Readonly<Record<string, IParameter>>;

  constructor(scope: Construct, id: string, props: SharedParametersProps) {
    super(scope, id);
    const parameters: Record<string, IParameter> = {};
    for (const [key, value] of Object.entries(props.values)) {
      if (!/^[a-z0-9][a-z0-9-_.]*$/i.test(key))
        throw new Error(`shared parameter key "${key}" must match [a-z0-9-_.]`);
      const name = props.context.paths.config(key);
      parameters[key] = Array.isArray(value)
        ? publishListParameter(this, pascal(key), name, value)
        : publishParameter(this, pascal(key), name, value);
    }
    this.parameters = parameters;
  }
}

export interface SharedSecretSpec {
  readonly description?: string;
  /** Generate a random value (default). The value can be overwritten out of band with `put-secret-value`. */
  readonly generate?: { length?: number; excludePunctuation?: boolean } | false;
  /** Publish an existing secret (by complete ARN) instead of creating one. */
  readonly existingArn?: string;
}

export interface SharedSecretsProps extends BaselineModuleProps {
  readonly secrets: Record<string, SharedSecretSpec>;
  readonly kmsKey?: IKey;
}

/**
 * Shared Secrets Manager secrets (`platform-<env>-<name>`) with their ARNs
 * published to `/platform/secrets/{name}/arn`. Values are generated on first
 * deploy and are expected to be rotated or replaced outside of CloudFormation
 * (for example `aws secretsmanager put-secret-value` from a CI secret), so no
 * secret material ever appears in a template.
 */
export class SharedSecrets extends Construct {
  readonly secrets: Readonly<Record<string, ISecret>>;

  constructor(scope: Construct, id: string, props: SharedSecretsProps) {
    super(scope, id);
    const { context } = props;
    const secrets: Record<string, ISecret> = {};
    for (const [name, spec] of Object.entries(props.secrets)) {
      if (!/^[a-z][a-z0-9-]*$/.test(name))
        throw new Error(`shared secret name "${name}" must be kebab-case`);
      let secret: ISecret;
      if (spec.existingArn !== undefined) {
        secret = Secret.fromSecretCompleteArn(this, pascal(name), spec.existingArn);
      } else {
        const generate = spec.generate === false ? undefined : (spec.generate ?? {});
        // Cast: `Secret` widens optional members with `undefined`, which exactOptionalPropertyTypes rejects.
        secret = new Secret(this, pascal(name), {
          secretName: context.naming.resource(ResourceKind.Secret, name),
          ...(spec.description !== undefined ? { description: spec.description } : {}),
          ...(props.kmsKey ? { encryptionKey: props.kmsKey } : {}),
          ...(generate
            ? {
                generateSecretString: {
                  passwordLength: generate.length ?? 32,
                  excludePunctuation: generate.excludePunctuation ?? true,
                },
              }
            : {}),
          removalPolicy: baselineRemovalPolicy(context),
        }) as ISecret;
      }
      publishParameter(
        this,
        `${pascal(name)}ArnParam`,
        context.paths.secretArn(name),
        secret.secretArn,
      );
      secrets[name] = secret;
    }
    this.secrets = secrets;
  }
}
