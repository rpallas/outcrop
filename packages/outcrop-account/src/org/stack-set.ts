import { readFileSync } from "node:fs";
import { CfnStackSet, type CfnStackSetProps, Stack, Stage } from "aws-cdk-lib";
import { Asset } from "aws-cdk-lib/aws-s3-assets";
import { Construct } from "constructs";

/** Inline template bodies are limited to 51,200 bytes; larger templates are uploaded as assets. */
export const STACK_SET_INLINE_TEMPLATE_LIMIT = 51_200;

export interface StackSetTargets {
  /** Organizational unit ids (`ou-example-...`) or the root id (`r-...`); SERVICE_MANAGED only. */
  readonly organizationalUnitIds?: string[];
  /** Explicit account ids; required for SELF_MANAGED, optional filter for SERVICE_MANAGED. */
  readonly accounts?: string[];
  /** Regions to deploy each instance into. Defaults to the region of the enclosing stack. */
  readonly regions?: string[];
}

export interface PlatformStackSetProps {
  /** Name of the StackSet. */
  readonly stackSetName: string;
  readonly description?: string;
  /**
   * Builds the stack to deploy in every target. It is synthesised into an isolated `Stage`
   * so its template can be embedded; the stack must be environment-agnostic and asset-free
   * (inline Lambda code only) unless every target account has the CDK asset bucket.
   */
  readonly template: (scope: Construct) => Stack;
  readonly targets: StackSetTargets;
  /** SERVICE_MANAGED deploys from the management/delegated administrator account. Default SERVICE_MANAGED. */
  readonly permissionModel?: "SERVICE_MANAGED" | "SELF_MANAGED";
  /** Automatically deploy to accounts added to the target OUs. Default true for SERVICE_MANAGED. */
  readonly autoDeployment?: boolean;
  /** Retain stacks when an account leaves the OU. Default false. */
  readonly retainStacksOnAccountRemoval?: boolean;
  /** Call as a delegated administrator instead of the management account. Default true. */
  readonly delegatedAdmin?: boolean;
  readonly parameters?: Record<string, string>;
  readonly capabilities?: string[];
  readonly operationPreferences?: CfnStackSet.OperationPreferencesProperty;
  /** SELF_MANAGED only: administration role ARN and execution role name. */
  readonly administrationRoleArn?: string;
  readonly executionRoleName?: string;
  /** Extra tags applied to every stack instance. */
  readonly tags?: Record<string, string>;
}

/**
 * Deploys a CDK stack to many accounts as a CloudFormation StackSet. The stack
 * is synthesised in an isolated stage and embedded inline (or uploaded as an
 * asset when larger than 50 KB). `addDependency` orders StackSets so, for
 * example, the OIDC baseline lands before service-specific StackSets.
 *
 * ```ts
 * new PlatformStackSet(this, "Baseline", {
 *   stackSetName: "platform-baseline",
 *   template: (scope) => new BaselineTemplateStack(scope, "Template"),
 *   targets: { organizationalUnitIds: ["ou-example-workloads"], regions: ["eu-west-1"] },
 * });
 * ```
 */
export class PlatformStackSet extends Construct {
  readonly stackSet: CfnStackSet;
  /** Size of the embedded template in bytes. */
  readonly templateSize: number;
  /** Whether the template was uploaded as an asset (`templateUrl`) or embedded (`templateBody`). */
  readonly usesAsset: boolean;

  constructor(scope: Construct, id: string, props: PlatformStackSetProps) {
    super(scope, id);
    const stack = Stack.of(this);
    const permissionModel = props.permissionModel ?? "SERVICE_MANAGED";
    const organizationalUnitIds = props.targets.organizationalUnitIds ?? [];
    const accounts = props.targets.accounts ?? [];
    if (permissionModel === "SERVICE_MANAGED" && organizationalUnitIds.length === 0) {
      throw new Error("SERVICE_MANAGED StackSets need targets.organizationalUnitIds");
    }
    if (permissionModel === "SELF_MANAGED" && accounts.length === 0) {
      throw new Error("SELF_MANAGED StackSets need targets.accounts");
    }

    // Synthesise the template stack in a nested stage (written under the app's cdk.out) so it
    // does not become part of this stack.
    const stage = new Stage(this, "Template");
    const templateStack = props.template(stage);
    const assembly = stage.synth({ force: true });
    const artifact = assembly.getStackArtifact(templateStack.artifactId);
    const body = readFileSync(artifact.templateFullPath, "utf8");
    this.templateSize = Buffer.byteLength(body, "utf8");
    this.usesAsset = this.templateSize > STACK_SET_INLINE_TEMPLATE_LIMIT;

    const templateSource: Pick<CfnStackSetProps, "templateBody" | "templateUrl"> = this.usesAsset
      ? {
          templateUrl: new Asset(this, "TemplateAsset", { path: artifact.templateFullPath })
            .httpUrl,
        }
      : { templateBody: body };

    const regions = props.targets.regions ?? [stack.region];
    const deploymentTargets: CfnStackSet.DeploymentTargetsProperty =
      permissionModel === "SERVICE_MANAGED"
        ? {
            organizationalUnitIds,
            ...(accounts.length > 0 ? { accounts, accountFilterType: "INTERSECTION" } : {}),
          }
        : { accounts };

    this.stackSet = new CfnStackSet(this, "Resource", {
      stackSetName: props.stackSetName,
      permissionModel,
      ...(props.description !== undefined ? { description: props.description } : {}),
      ...templateSource,
      capabilities: props.capabilities ?? ["CAPABILITY_NAMED_IAM", "CAPABILITY_AUTO_EXPAND"],
      ...(props.parameters
        ? {
            parameters: Object.entries(props.parameters).map(([parameterKey, parameterValue]) => ({
              parameterKey,
              parameterValue,
            })),
          }
        : {}),
      ...(permissionModel === "SERVICE_MANAGED"
        ? {
            autoDeployment: {
              enabled: props.autoDeployment ?? true,
              retainStacksOnAccountRemoval: props.retainStacksOnAccountRemoval ?? false,
            },
            callAs: (props.delegatedAdmin ?? true) ? "DELEGATED_ADMIN" : "SELF",
          }
        : {
            ...(props.administrationRoleArn !== undefined
              ? { administrationRoleArn: props.administrationRoleArn }
              : {}),
            ...(props.executionRoleName !== undefined
              ? { executionRoleName: props.executionRoleName }
              : {}),
          }),
      stackInstancesGroup: [{ deploymentTargets, regions }],
      operationPreferences: props.operationPreferences ?? {
        failureToleranceCount: 0,
        maxConcurrentPercentage: 100,
        regionConcurrencyType: "PARALLEL",
      },
      ...(props.tags
        ? { tags: Object.entries(props.tags).map(([key, value]) => ({ key, value })) }
        : {}),
    });
  }

  /** Deploy this StackSet only after `other` has completed. */
  addDependency(other: PlatformStackSet): void {
    this.stackSet.addResourceDependency(other.stackSet);
  }
}
