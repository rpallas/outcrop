export const ALERT_SEVERITIES = ["critical", "high", "medium", "low"] as const;

/**
 * Alert severity. Each severity maps to one SNS topic per environment so that
 * routing (pager, chat channel, email digest) is an account-level decision.
 */
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const isAlertSeverity = (value: string): value is AlertSeverity =>
  (ALERT_SEVERITIES as readonly string[]).includes(value);

/**
 * Builds the well-known SSM parameter paths of the platform contract.
 * Written by `@rpallas/platform-cdk-account`, read by the `@rpallas/platform-cdk`
 * constructs at synth time and by this package at runtime.
 *
 * This is a CDK-free mirror of `PlatformParameterPaths` in `@rpallas/platform-cdk`.
 */
export class PlatformParameterPaths {
  readonly root: string;

  constructor(rootPrefix = "/platform") {
    this.root = rootPrefix.replace(/\/+$/, "");
  }

  private join(...parts: string[]): string {
    return [this.root, ...parts.map((p) => p.replace(/^\/+|\/+$/g, ""))].join("/");
  }

  readonly account = {
    id: (): string => this.join("account", "id"),
    name: (): string => this.join("account", "name"),
    kmsKeyArn: (): string => this.join("account", "kms", "key-arn"),
    kmsKeyId: (): string => this.join("account", "kms", "key-id"),
    vpcId: (): string => this.join("account", "vpc", "id"),
    vpcCidr: (): string => this.join("account", "vpc", "cidr"),
    vpcPrivateSubnetIds: (): string => this.join("account", "vpc", "private-subnet-ids"),
    vpcPublicSubnetIds: (): string => this.join("account", "vpc", "public-subnet-ids"),
    vpcIsolatedSubnetIds: (): string => this.join("account", "vpc", "isolated-subnet-ids"),
    vpcAvailabilityZones: (): string => this.join("account", "vpc", "availability-zones"),
    vpcLambdaSecurityGroupId: (): string => this.join("account", "vpc", "lambda-security-group-id"),
    oidcProviderArn: (): string => this.join("account", "deploy", "oidc-provider-arn"),
    deployRoleArn: (repo: string): string => this.join("account", "deploy", "role-arn", repo),
    readonlyRoleArn: (repo: string): string =>
      this.join("account", "deploy", "readonly-role-arn", repo),
    logRetentionDays: (): string => this.join("account", "log-retention-days"),
    cloudTrailBucketName: (): string => this.join("account", "security", "cloudtrail-bucket-name"),
    accessLogsBucketName: (): string => this.join("account", "logging", "access-logs-bucket-name"),
  };

  readonly env = (env: string): EnvironmentParameterPaths => ({
    name: () => this.join("env", env, "name"),
    domain: () => this.join("env", env, "domain"),
    dnsZoneId: () => this.join("env", env, "dns", "zone-id"),
    dnsZoneName: () => this.join("env", env, "dns", "zone-name"),
    certRegionalArn: () => this.join("env", env, "certs", "regional-arn"),
    certUsEast1Arn: () => this.join("env", env, "certs", "us-east-1-arn"),
    alertTopicArn: (severity: AlertSeverity) =>
      this.join("env", env, "alerts", "topic-arn", severity),
    eventBusName: () => this.join("env", env, "events", "bus-name"),
    eventBusArn: () => this.join("env", env, "events", "bus-arn"),
    root: () => this.join("env", env),
  });

  /** Shared plain configuration value. */
  config(key: string): string {
    return this.join("config", key);
  }

  /** ARN of a shared Secrets Manager secret. */
  secretArn(name: string): string {
    return this.join("secrets", name, "arn");
  }

  /** Values a service publishes about itself, e.g. `/platform/services/orders/api-url`. */
  service(service: string, key: string): string {
    return this.join("services", service, key);
  }
}

export interface EnvironmentParameterPaths {
  name(): string;
  domain(): string;
  dnsZoneId(): string;
  dnsZoneName(): string;
  certRegionalArn(): string;
  certUsEast1Arn(): string;
  alertTopicArn(severity: AlertSeverity): string;
  eventBusName(): string;
  eventBusArn(): string;
  root(): string;
}
