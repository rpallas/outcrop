import { Token } from "aws-cdk-lib";
import { ParameterTier, StringParameter, type StringParameterProps } from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { PlatformStack } from "../core/platform-stack";

/** Standard tier parameters hold up to 4 KB; larger values need the advanced tier. */
export const STANDARD_TIER_MAX_BYTES = 4096;

export interface PlatformParameterProps extends Omit<
  StringParameterProps,
  "parameterName" | "stringValue" | "tier"
> {
  /** Key below the service path, e.g. `api-url` -> `/platform/services/{service}/api-url`. */
  readonly key: string;
  /** Value to store. */
  readonly value: string;
  /** Absolute path overriding the derived service path. */
  readonly path?: string;
  /** Parameter tier. Default: standard, or advanced when the value exceeds 4 KB. */
  readonly tier?: ParameterTier;
}

/**
 * SSM parameter a service publishes about itself under the platform contract
 * (`/platform/services/{service}/{key}`; preview stacks get their own prefix).
 */
export class PlatformParameter extends StringParameter {
  /** Path of a parameter published by another service (base deployment, not a preview). */
  static servicePath(scope: Construct, service: string, key: string): string {
    return PlatformStack.of(scope).params.paths.service(service, key);
  }

  /** Deploy-time value of a parameter published by another service. */
  static serviceValue(scope: Construct, service: string, key: string): string {
    return PlatformStack.of(scope).params.value(PlatformParameter.servicePath(scope, service, key));
  }

  readonly key: string;

  constructor(scope: Construct, id: string, props: PlatformParameterProps) {
    const stack = PlatformStack.of(scope);
    const { key, value, path, tier, ...parameterProps } = props;
    const parameterName = path ?? stack.params.paths.service(stack.naming.prefix("/"), key);
    const resolvedTier =
      tier ??
      (!Token.isUnresolved(value) && Buffer.byteLength(value, "utf8") > STANDARD_TIER_MAX_BYTES
        ? ParameterTier.ADVANCED
        : ParameterTier.STANDARD);

    super(scope, id, {
      description: `${stack.config.service} ${key} (${stack.envName})`,
      ...parameterProps,
      parameterName,
      stringValue: value,
      tier: resolvedTier,
    });
    this.key = key;
  }
}
