import { AnyPrincipal, Effect, type IPrincipal, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Key, type KeyProps } from "aws-cdk-lib/aws-kms";
import type { Construct } from "constructs";
import { PlatformStack } from "../core/platform-stack";
import { ResourceKind } from "../naming/resource-kind";
import { kebab } from "../util/kebab";

export interface PlatformKeyProps extends Omit<
  KeyProps,
  "alias" | "enableKeyRotation" | "removalPolicy"
> {
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /** Principals granted encrypt/decrypt through the key policy (for example roles in other accounts). */
  readonly allowedPrincipals?: IPrincipal[];
  /**
   * AWS Organizations id (`o-example`). Every principal in the organization
   * may use the key for encrypt/decrypt operations.
   */
  readonly grantOrganization?: string;
}

const USAGE_ACTIONS = [
  "kms:Encrypt",
  "kms:Decrypt",
  "kms:ReEncrypt*",
  "kms:GenerateDataKey*",
  "kms:DescribeKey",
];

/**
 * Customer managed KMS key with rotation enabled, an alias from the platform
 * naming and the stack removal policy. Use it when a service needs its own key
 * instead of the account platform key from the SSM contract.
 */
export class PlatformKey extends Key {
  readonly shortName: string;
  /** Alias name including the `alias/` prefix. */
  readonly aliasName: string;

  constructor(scope: Construct, id: string, props: PlatformKeyProps = {}) {
    const stack = PlatformStack.of(scope);
    const { name, allowedPrincipals, grantOrganization, ...keyProps } = props;
    const shortName = name ?? kebab(id);
    const aliasName = `alias/${stack.naming.resource(ResourceKind.KmsAlias, shortName)}`;

    super(scope, id, {
      description: `${stack.config.service} ${shortName} (${stack.envName})`,
      ...keyProps,
      alias: aliasName,
      enableKeyRotation: true,
      removalPolicy: stack.removalPolicy,
    });
    this.shortName = shortName;
    this.aliasName = aliasName;

    if (allowedPrincipals && allowedPrincipals.length > 0) {
      this.addToResourcePolicy(
        new PolicyStatement({
          sid: "PlatformAllowedPrincipals",
          effect: Effect.ALLOW,
          principals: allowedPrincipals,
          actions: USAGE_ACTIONS,
          resources: ["*"],
        }),
      );
    }
    if (grantOrganization) {
      this.addToResourcePolicy(
        new PolicyStatement({
          sid: "PlatformAllowOrganization",
          effect: Effect.ALLOW,
          principals: [new AnyPrincipal()],
          actions: USAGE_ACTIONS,
          resources: ["*"],
          conditions: { StringEquals: { "aws:PrincipalOrgID": grantOrganization } },
        }),
      );
    }
  }
}
