import { Stack, Token } from "aws-cdk-lib";
import { Certificate, type ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { Vpc, type IVpc, SecurityGroup, type ISecurityGroup } from "aws-cdk-lib/aws-ec2";
import { EventBus, type IEventBus } from "aws-cdk-lib/aws-events";
import { Key, type IKey } from "aws-cdk-lib/aws-kms";
import { HostedZone, type IHostedZone } from "aws-cdk-lib/aws-route53";
import { Secret, type ISecret } from "aws-cdk-lib/aws-secretsmanager";
import { Topic, type ITopic } from "aws-cdk-lib/aws-sns";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import type { Construct } from "constructs";
import type { AlertSeverity } from "../alerting/severity";
import { type EnvironmentParameterPaths, PlatformParameterPaths } from "./paths";

export interface PlatformParametersProps {
  /** Environment name used for env-scoped paths. */
  readonly env: string;
  /** Root prefix of the SSM contract. */
  readonly rootPrefix?: string | undefined;
}

export interface LookupOptions {
  /** Value used when the parameter is not yet in cdk.context.json (first synth / tests). */
  readonly defaultValue?: string;
}

const PLACEHOLDER_ACCOUNT = "111111111111";
const placeholderCertificateArn = (region: string): string =>
  `arn:aws:acm:${region}:${PLACEHOLDER_ACCOUNT}:certificate/00000000-0000-0000-0000-000000000000`;

/**
 * Typed reader for the SSM parameter contract (ADR 0003).
 *
 * - `value(path)` returns a deploy-time token (`{{resolve:ssm:...}}` via a CloudFormation parameter).
 * - `lookup(path)` resolves at synth time through the CDK context provider and is
 *   required for values that CloudFormation cannot take as tokens (hosted zone
 *   ids, certificate ARNs used by some resources, subnet lists).
 *
 * Imported constructs are cached per scope so repeated calls return the same
 * construct instead of duplicating imports.
 */
export class PlatformParameters {
  readonly paths: PlatformParameterPaths;
  readonly envName: string;
  private readonly imports = new Map<string, unknown>();

  constructor(
    readonly scope: Construct,
    props: PlatformParametersProps,
  ) {
    this.paths = new PlatformParameterPaths(props.rootPrefix ?? "/platform");
    this.envName = props.env;
  }

  /** Deploy-time value of any parameter path. */
  value(path: string): string {
    return StringParameter.valueForStringParameter(this.scope, path);
  }

  /** Synth-time value of any parameter path (context lookup). */
  lookup(path: string, options: LookupOptions = {}): string {
    const stack = Stack.of(this.scope);
    if (Token.isUnresolved(stack.account) || Token.isUnresolved(stack.region)) {
      throw new Error(
        `Cannot look up SSM parameter "${path}" at synth time because the stack has no concrete account/region. ` +
          "Set `account` on the environment in platform.config.ts or export CDK_DEFAULT_ACCOUNT.",
      );
    }
    return StringParameter.valueFromLookup(this.scope, path, options.defaultValue);
  }

  /** Comma separated list parameter resolved at synth time. */
  lookupList(path: string, options: LookupOptions = {}): string[] {
    return this.lookup(path, options)
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }

  /**
   * Read a parameter that lives in another region (for example the us-east-1
   * certificate ARN when the baseline stores it only there). Returns a deploy-time token.
   */
  crossRegionValue(id: string, path: string, region: string): string {
    return this.cached(`xr:${region}:${path}`, () => {
      const resource = new AwsCustomResource(this.scope, id, {
        onUpdate: {
          service: "SSM",
          action: "getParameter",
          parameters: { Name: path },
          region,
          physicalResourceId: PhysicalResourceId.of(`${region}:${path}`),
        },
        policy: AwsCustomResourcePolicy.fromSdkCalls({
          resources: [`arn:aws:ssm:${region}:${Stack.of(this.scope).account}:parameter${path}`],
        }),
        installLatestAwsSdk: false,
      });
      return resource.getResponseField("Parameter.Value");
    });
  }

  /** Shared plain configuration value (`/platform/config/{key}`). */
  config(key: string): string {
    return this.value(this.paths.config(key));
  }

  /** ARN of a shared secret (`/platform/secrets/{name}/arn`). */
  secretArn(name: string): string {
    return this.value(this.paths.secretArn(name));
  }

  /** Import a shared secret by contract name. */
  secret(name: string): ISecret {
    return this.cached(`secret:${name}`, () =>
      Secret.fromSecretCompleteArn(this.scope, `SharedSecret${pascal(name)}`, this.secretArn(name)),
    );
  }

  readonly account = {
    id: (): string => this.value(this.paths.account.id()),
    name: (): string => this.value(this.paths.account.name()),
    kmsKeyArn: (): string => this.value(this.paths.account.kmsKeyArn()),
    kmsKey: (): IKey =>
      this.cached("account:kms", () =>
        Key.fromKeyArn(this.scope, "PlatformAccountKey", this.account.kmsKeyArn()),
      ),
    deployRoleArn: (repo: string): string => this.value(this.paths.account.deployRoleArn(repo)),
    logRetentionDays: (): string => this.value(this.paths.account.logRetentionDays()),
    accessLogsBucketName: (): string => this.value(this.paths.account.accessLogsBucketName()),
    vpcId: (): string =>
      this.lookup(this.paths.account.vpcId(), { defaultValue: "vpc-00000000000000000" }),
    /** Import the account VPC using synth-time lookups of the contract parameters. */
    vpc: (): IVpc =>
      this.cached("account:vpc", () => {
        const azs = this.lookupList(this.paths.account.vpcAvailabilityZones(), {
          defaultValue: `${Stack.of(this.scope).region}a,${Stack.of(this.scope).region}b`,
        });
        const privateSubnetIds = this.lookupList(this.paths.account.vpcPrivateSubnetIds(), {
          defaultValue: "subnet-00000000000000001,subnet-00000000000000002",
        });
        const publicSubnetIds = this.lookupList(this.paths.account.vpcPublicSubnetIds(), {
          defaultValue: "subnet-00000000000000003,subnet-00000000000000004",
        });
        return Vpc.fromVpcAttributes(this.scope, "PlatformAccountVpc", {
          vpcId: this.account.vpcId(),
          availabilityZones: azs,
          privateSubnetIds,
          publicSubnetIds,
        });
      }),
    lambdaSecurityGroup: (): ISecurityGroup =>
      this.cached("account:vpc:lambda-sg", () =>
        SecurityGroup.fromSecurityGroupId(
          this.scope,
          "PlatformLambdaSecurityGroup",
          this.lookup(this.paths.account.vpcLambdaSecurityGroupId(), {
            defaultValue: "sg-00000000000000000",
          }),
        ),
      ),
  };

  readonly env = {
    paths: (): EnvironmentParameterPaths => this.paths.env(this.envName),
    domain: (): string => this.value(this.paths.env(this.envName).domain()),
    dnsZoneId: (): string =>
      this.lookup(this.paths.env(this.envName).dnsZoneId(), {
        defaultValue: "Z0000000000000000000A",
      }),
    dnsZoneName: (): string =>
      this.lookup(this.paths.env(this.envName).dnsZoneName(), {
        defaultValue: `${this.envName}.example.com`,
      }),
    hostedZone: (): IHostedZone =>
      this.cached("env:zone", () =>
        HostedZone.fromHostedZoneAttributes(this.scope, "PlatformHostedZone", {
          hostedZoneId: this.env.dnsZoneId(),
          zoneName: this.env.dnsZoneName(),
        }),
      ),
    certificateArn: (): string =>
      this.lookup(this.paths.env(this.envName).certRegionalArn(), {
        defaultValue: placeholderCertificateArn(Stack.of(this.scope).region),
      }),
    certificate: (): ICertificate =>
      this.cached("env:cert", () =>
        Certificate.fromCertificateArn(
          this.scope,
          "PlatformRegionalCertificate",
          this.env.certificateArn(),
        ),
      ),
    usEast1CertificateArn: (): string =>
      this.lookup(this.paths.env(this.envName).certUsEast1Arn(), {
        defaultValue: placeholderCertificateArn("us-east-1"),
      }),
    usEast1Certificate: (): ICertificate =>
      this.cached("env:cert-use1", () =>
        Certificate.fromCertificateArn(
          this.scope,
          "PlatformEdgeCertificate",
          this.env.usEast1CertificateArn(),
        ),
      ),
    alertTopicArn: (severity: AlertSeverity): string =>
      this.value(this.paths.env(this.envName).alertTopicArn(severity)),
    alertTopic: (severity: AlertSeverity): ITopic =>
      this.cached(`env:alerts:${severity}`, () =>
        Topic.fromTopicArn(
          this.scope,
          `PlatformAlertTopic${pascal(severity)}`,
          this.env.alertTopicArn(severity),
        ),
      ),
    eventBusName: (): string => this.value(this.paths.env(this.envName).eventBusName()),
    eventBusArn: (): string => this.value(this.paths.env(this.envName).eventBusArn()),
    eventBus: (): IEventBus =>
      this.cached("env:bus", () =>
        EventBus.fromEventBusArn(this.scope, "PlatformEventBus", this.env.eventBusArn()),
      ),
  };

  private cached<T>(key: string, factory: () => T): T {
    const existing = this.imports.get(key);
    if (existing !== undefined) return existing as T;
    const created = factory();
    this.imports.set(key, created);
    return created;
  }
}

const pascal = (value: string): string =>
  value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
