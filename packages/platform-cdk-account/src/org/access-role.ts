import { Duration, Stack } from "aws-cdk-lib";
import {
  AccountPrincipal,
  Effect,
  type IPrincipal,
  type ManagedPolicy,
  PolicyDocument,
  PolicyStatement,
  PrincipalWithConditions,
  Role,
} from "aws-cdk-lib/aws-iam";
import type { IHostedZone } from "aws-cdk-lib/aws-route53";
import { type Construct } from "constructs";
import { output } from "../modules/base";

export interface OrganizationsAccessRoleProps {
  /** Account allowed to assume the role (management, delegated administrator or a shared-services account). */
  readonly trustedAccountId: string;
  /** Fixed role name so other accounts can build the ARN without lookups. */
  readonly roleName: string;
  readonly description?: string;
  /** Statements the role is granted. */
  readonly statements: PolicyStatement[];
  readonly managedPolicies?: ManagedPolicy[];
  /** Require `sts:ExternalId` when assuming. */
  readonly externalId?: string;
  /** Restrict the trust to principals in this organisation. */
  readonly organizationId?: string;
  readonly maxSessionDuration?: Duration;
}

/**
 * A role in this account that a trusted account of the organisation may assume
 * for a narrow purpose: cross-account DNS delegation, account name lookups,
 * StackSet administration. The trust policy is limited to one account (and
 * optionally an external id and organisation id).
 */
export class OrganizationsAccessRole extends Role {
  /** Role that lets the trusted account create NS delegation records in `zone` (for `CrossAccountZoneDelegationRecord`). */
  static dnsDelegation(
    scope: Construct,
    id: string,
    props: Omit<OrganizationsAccessRoleProps, "statements"> & { zone: IHostedZone },
  ): OrganizationsAccessRole {
    const { zone, ...rest } = props;
    return new OrganizationsAccessRole(scope, id, {
      description: `Allows account ${props.trustedAccountId} to delegate subdomains of ${zone.zoneName}`,
      ...rest,
      statements: [
        new PolicyStatement({
          sid: "ChangeDelegationRecords",
          effect: Effect.ALLOW,
          actions: ["route53:ChangeResourceRecordSets"],
          resources: [zone.hostedZoneArn],
          conditions: {
            "ForAllValues:StringEquals": {
              "route53:ChangeResourceRecordSetsRecordTypes": ["NS"],
              "route53:ChangeResourceRecordSetsActions": ["UPSERT", "DELETE"],
            },
          },
        }),
        new PolicyStatement({
          sid: "ListZones",
          effect: Effect.ALLOW,
          actions: ["route53:ListHostedZonesByName", "route53:GetChange"],
          resources: ["*"],
        }),
      ],
    });
  }

  /** Role that lets the trusted account read this account's platform SSM parameters (cross-account lookups). */
  static parameterReader(
    scope: Construct,
    id: string,
    props: Omit<OrganizationsAccessRoleProps, "statements"> & { ssmRootPrefix?: string },
  ): OrganizationsAccessRole {
    const { ssmRootPrefix, ...rest } = props;
    const stack = Stack.of(scope);
    const prefix = (ssmRootPrefix ?? "/platform").replace(/^\//, "");
    return new OrganizationsAccessRole(scope, id, {
      description: `Allows account ${props.trustedAccountId} to read /${prefix}/* parameters`,
      ...rest,
      statements: [
        new PolicyStatement({
          sid: "ReadPlatformParameters",
          effect: Effect.ALLOW,
          actions: ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"],
          resources: [
            stack.formatArn({ service: "ssm", resource: "parameter", resourceName: `${prefix}/*` }),
          ],
        }),
      ],
    });
  }

  constructor(scope: Construct, id: string, props: OrganizationsAccessRoleProps) {
    const conditions: Record<string, Record<string, string>> = {};
    if (props.externalId !== undefined)
      conditions["StringEquals"] = {
        ...conditions["StringEquals"],
        "sts:ExternalId": props.externalId,
      };
    if (props.organizationId !== undefined)
      conditions["StringEquals"] = {
        ...conditions["StringEquals"],
        "aws:PrincipalOrgID": props.organizationId,
      };
    const base: IPrincipal = new AccountPrincipal(props.trustedAccountId);
    const assumedBy =
      Object.keys(conditions).length > 0 ? new PrincipalWithConditions(base, conditions) : base;
    super(scope, id, {
      roleName: props.roleName,
      assumedBy,
      ...(props.description !== undefined ? { description: props.description } : {}),
      maxSessionDuration: props.maxSessionDuration ?? Duration.hours(1),
      inlinePolicies: { access: new PolicyDocument({ statements: props.statements }) },
      ...(props.managedPolicies ? { managedPolicies: props.managedPolicies } : {}),
    });
    output(this, "RoleArn", this.roleArn);
  }
}
