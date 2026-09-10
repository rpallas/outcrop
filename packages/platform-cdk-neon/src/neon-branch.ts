import path from "node:path";
import { CfnOutput, Duration } from "aws-cdk-lib";
import { type Grant, type IGrantable, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { type ISecret, Secret } from "aws-cdk-lib/aws-secretsmanager";
import {
  lambdaEntry,
  PlatformCustomResource,
  type PlatformFunction,
  PlatformStack,
  ResourceKind,
} from "@rpallas/platform-cdk";
import { Construct } from "constructs";
import type { NeonBranchResourceProperties } from "./handlers/neon-branch";

export const NEON_DEFAULT_API_BASE_URL = "https://console.neon.tech/api/v2";
export const NEON_DEFAULT_API_KEY_SECRET = "neon-api-key";
export const NEON_DEFAULT_CONNECTION_SECRET = "neon-connection";

export interface NeonBranchProps {
  /** Neon project id (`Project settings` in the Neon console). */
  readonly projectId: string;
  /**
   * Name of the shared secret holding the Neon API key, published by the
   * account baseline under `/platform/secrets/{name}/arn`. Default `neon-api-key`.
   */
  readonly apiKeySecretName?: string;
  /** Explicit API key secret instead of `apiKeySecretName`. */
  readonly apiKeySecret?: ISecret;
  /** Branch the preview branch is created from (name or `br-...` id). Default `main`. */
  readonly parentBranch?: string;
  /** Branch name. Default `<previewId>-<service>-db` (platform naming, kind `generic`, name `db`). */
  readonly branchName?: string;
  /** Database name inside the branch. Default `neondb`. */
  readonly database?: string;
  /** Role whose password is stored in the connection secret. Default `neondb_owner`. */
  readonly role?: string;
  /**
   * Create a branch in non-preview stacks too. Default false: base environments
   * import the shared `baseConnectionSecretName` secret instead.
   */
  readonly createInBaseEnvironment?: boolean;
  /**
   * Shared secret with the base environment connection details, used when no
   * branch is created. Default `neon-connection`.
   */
  readonly baseConnectionSecretName?: string;
  /** Prefer the connection pooler host in `connectionString`. Default true. */
  readonly pooled?: boolean;
  /** Compute auto-suspend timeout for the branch endpoint, in seconds. */
  readonly suspendTimeoutSeconds?: number;
  /** Neon API base URL. Default `https://console.neon.tech/api/v2`. */
  readonly apiBaseUrl?: string;
}

/**
 * A Neon Postgres branch per preview stack. The branch is created from
 * `parentBranch` by a custom resource, its connection details are written to a
 * Secrets Manager secret owned by the stack and the branch is deleted with the
 * stack. Base environments import the shared connection secret instead unless
 * `createInBaseEnvironment` is set.
 */
export class NeonBranch extends Construct {
  /**
   * Secret holding `{ host, pooledHost, port, database, user, password, connectionString,
   * directConnectionString, pooledConnectionString, branchId, projectId }`.
   * `connectionString` uses the pooler host when `pooled` is true (the default).
   */
  readonly connectionSecret: ISecret;
  /** Neon branch id (deploy-time token); undefined when no branch is created. */
  readonly branchId: string | undefined;
  /** Endpoint host of the branch (deploy-time token); undefined when no branch is created. */
  readonly host: string | undefined;
  /** Pooler host of the branch (deploy-time token); undefined when no branch is created. */
  readonly pooledHost: string | undefined;
  /** True when this construct manages a branch, false when it imports the shared secret. */
  readonly isBranch: boolean;
  /** Effective branch name (only when a branch is created). */
  readonly branchName: string | undefined;
  /** Custom resource handler (only when a branch is created). */
  readonly handler: PlatformFunction | undefined;
  /** The custom resource (only when a branch is created). */
  readonly resource: PlatformCustomResource<NeonBranchResourceProperties> | undefined;
  /** Whether `connectionString` consumers should use the pooler host. */
  readonly pooled: boolean;

  constructor(scope: Construct, id: string, props: NeonBranchProps) {
    super(scope, id);
    const stack = PlatformStack.of(this);
    this.pooled = props.pooled ?? true;
    this.isBranch = stack.isPreview || props.createInBaseEnvironment === true;

    if (!this.isBranch) {
      this.connectionSecret = stack.params.secret(
        props.baseConnectionSecretName ?? NEON_DEFAULT_CONNECTION_SECRET,
      );
      this.branchId = undefined;
      this.host = undefined;
      this.pooledHost = undefined;
      this.branchName = undefined;
      this.handler = undefined;
      this.resource = undefined;
    } else {
      const apiKeySecret =
        props.apiKeySecret ??
        stack.params.secret(props.apiKeySecretName ?? NEON_DEFAULT_API_KEY_SECRET);
      const branchName = props.branchName ?? stack.naming.resource(ResourceKind.Generic, "db");

      // Created empty (CloudFormation generates a placeholder value); the handler
      // writes the real connection details so they never appear in the template.
      // Cast: `Secret` widens optional members with `undefined`, which exactOptionalPropertyTypes rejects.
      const connectionSecret = new Secret(this, "Connection", {
        secretName: stack.naming.resource(ResourceKind.Secret, NEON_DEFAULT_CONNECTION_SECRET),
        description: `Neon connection details for ${stack.config.service} branch ${branchName}`,
        removalPolicy: stack.removalPolicy,
      }) as ISecret;

      const handler = PlatformCustomResource.handler(this, "Handler", {
        entry: lambdaEntry(path.join(__dirname, "handlers", "neon-branch")),
        description: "platform-cdk-neon: manages a Neon branch for this stack",
        timeout: Duration.minutes(5),
        memorySize: 256,
        policyStatements: [
          new PolicyStatement({
            actions: [
              "secretsmanager:PutSecretValue",
              "secretsmanager:DescribeSecret",
              "secretsmanager:UpdateSecret",
              "secretsmanager:TagResource",
            ],
            resources: [connectionSecret.secretArn],
          }),
        ],
      });
      apiKeySecret.grantRead(handler);

      const properties: NeonBranchResourceProperties = {
        projectId: props.projectId,
        parentBranch: props.parentBranch ?? "main",
        branchName,
        database: props.database ?? "neondb",
        role: props.role ?? "neondb_owner",
        connectionSecretArn: connectionSecret.secretArn,
        apiKeySecretArn: apiKeySecret.secretArn,
        apiBaseUrl: props.apiBaseUrl ?? NEON_DEFAULT_API_BASE_URL,
        pooled: this.pooled ? "true" : "false",
        ...(props.suspendTimeoutSeconds !== undefined
          ? { suspendTimeoutSeconds: String(props.suspendTimeoutSeconds) }
          : {}),
      };
      const resource = new PlatformCustomResource<NeonBranchResourceProperties>(this, "Branch", {
        resourceType: "Custom::NeonBranch",
        onEvent: handler,
        properties,
      });
      resource.node.addDependency(connectionSecret);

      this.connectionSecret = connectionSecret;
      this.branchId = resource.getAttString("BranchId");
      this.host = resource.getAttString("Host");
      this.pooledHost = resource.getAttString("PooledHost");
      this.branchName = branchName;
      this.handler = handler;
      this.resource = resource;
    }

    const output = new CfnOutput(this, "ConnectionSecretArn", {
      value: this.connectionSecret.secretArn,
      description: "Secrets Manager ARN with the Neon connection details",
    });
    output.overrideLogicalId(`${id.replace(/[^A-Za-z0-9]/g, "")}ConnectionSecretArn`);
  }

  /** Allow `grantee` to read the connection secret. */
  grantRead(grantee: IGrantable): Grant {
    return this.connectionSecret.grantRead(grantee);
  }
}
