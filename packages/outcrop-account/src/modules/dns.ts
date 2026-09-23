import { Duration, Stack } from "aws-cdk-lib";
import {
  Certificate,
  CertificateValidation,
  type ICertificate,
} from "aws-cdk-lib/aws-certificatemanager";
import { Role } from "aws-cdk-lib/aws-iam";
import {
  CrossAccountZoneDelegationRecord,
  HostedZone,
  type IHostedZone,
  PublicHostedZone,
  ZoneDelegationRecord,
} from "aws-cdk-lib/aws-route53";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { type BaselineModuleProps, baselineRemovalPolicy, output, publishParameter } from "./base";

export interface DnsProps extends BaselineModuleProps {
  /** Environment domain. Defaults to `environment.domain` from the config. */
  readonly domain?: string;
  /** Import an existing hosted zone instead of creating one. */
  readonly existingHostedZoneId?: string;
  /** Issue a wildcard + apex certificate in the stack region. Default true. */
  readonly regionalCertificate?: boolean;
  /** Extra subject alternative names for the regional certificate. */
  readonly additionalNames?: string[];
}

/**
 * Environment hosted zone, optional delegation from a parent zone (same or
 * cross-account) and a regional wildcard certificate. Publishes
 * `/platform/env/{env}/dns/*` and `/platform/env/{env}/certs/regional-arn`.
 *
 * Certificates for CloudFront must live in `us-east-1`; see `EdgeCertificate`
 * which `AccountBaselineStack` creates as a companion stack when needed.
 */
export class Dns extends Construct {
  readonly hostedZone: IHostedZone;
  readonly domain: string;
  readonly regionalCertificate?: ICertificate;

  constructor(scope: Construct, id: string, props: DnsProps) {
    super(scope, id);
    const { context } = props;
    const domain = props.domain ?? context.environment.domain;
    if (!domain)
      throw new Error(
        `environment "${context.env}" has no domain; set environments.${context.env}.domain to enable DNS`,
      );
    this.domain = domain;
    const paths = context.paths.env(context.env);

    if (props.existingHostedZoneId !== undefined) {
      this.hostedZone = HostedZone.fromHostedZoneAttributes(this, "Zone", {
        hostedZoneId: props.existingHostedZoneId,
        zoneName: domain,
      });
    } else {
      const zone = new PublicHostedZone(this, "Zone", {
        zoneName: domain,
        comment: `${context.config.project} ${context.env}`,
      });
      zone.applyRemovalPolicy(baselineRemovalPolicy(context));
      this.hostedZone = zone;

      const parent = context.environment.parentZone;
      if (parent) {
        if (parent.delegationRoleArn !== undefined) {
          new CrossAccountZoneDelegationRecord(this, "Delegation", {
            delegatedZone: zone,
            parentHostedZoneId: parent.hostedZoneId,
            delegationRole: Role.fromRoleArn(this, "DelegationRole", parent.delegationRoleArn, {
              mutable: false,
            }),
            ttl: Duration.hours(1),
          });
        } else {
          const parentZone = HostedZone.fromHostedZoneAttributes(this, "ParentZone", {
            hostedZoneId: parent.hostedZoneId,
            zoneName: parent.zoneName,
          });
          new ZoneDelegationRecord(this, "Delegation", {
            zone: parentZone,
            recordName: domain,
            nameServers: zone.hostedZoneNameServers ?? [],
            ttl: Duration.hours(1),
          });
        }
      }
      if (zone.hostedZoneNameServers) {
        output(
          this,
          "NameServers",
          Stack.of(this).toJsonString(zone.hostedZoneNameServers),
          `NS records to create for ${domain}`,
        );
      }
    }

    publishParameter(this, "DomainParam", paths.domain(), domain);
    publishParameter(this, "ZoneIdParam", paths.dnsZoneId(), this.hostedZone.hostedZoneId);
    publishParameter(this, "ZoneNameParam", paths.dnsZoneName(), domain);

    if (props.regionalCertificate !== false) {
      const certificate = new Certificate(this, "RegionalCertificate", {
        domainName: domain,
        subjectAlternativeNames: [`*.${domain}`, ...(props.additionalNames ?? [])],
        validation: CertificateValidation.fromDns(this.hostedZone),
      });
      this.regionalCertificate = certificate;
      publishParameter(
        this,
        "RegionalCertParam",
        paths.certRegionalArn(),
        certificate.certificateArn,
      );
    }
  }
}

export interface EdgeCertificateProps {
  readonly context: BaselineModuleProps["context"];
  /** Hosted zone id of the environment zone (deployed by `Dns` in the home region). */
  readonly hostedZoneId: string;
  readonly domain: string;
  /** Region that hosts the SSM contract; the certificate ARN is written there. */
  readonly homeRegion: string;
}

/**
 * Wildcard certificate in `us-east-1` for CloudFront and publishes its ARN into
 * the home region's SSM contract (`/platform/env/{env}/certs/us-east-1-arn`).
 * Must be placed in a stack whose region is `us-east-1`.
 */
export class EdgeCertificate extends Construct {
  readonly certificate: ICertificate;

  constructor(scope: Construct, id: string, props: EdgeCertificateProps) {
    super(scope, id);
    const stack = Stack.of(this);
    if (stack.region !== "us-east-1") {
      throw new Error(`EdgeCertificate must be created in a us-east-1 stack (got ${stack.region})`);
    }
    const zone = HostedZone.fromHostedZoneAttributes(this, "Zone", {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.domain,
    });
    this.certificate = new Certificate(this, "Certificate", {
      domainName: props.domain,
      subjectAlternativeNames: [`*.${props.domain}`],
      validation: CertificateValidation.fromDns(zone),
    });
    const paths = props.context.paths.env(props.context.env);
    if (props.homeRegion === "us-east-1") {
      publishParameter(
        this,
        "UsEast1CertParam",
        paths.certUsEast1Arn(),
        this.certificate.certificateArn,
      );
    } else {
      // Cross-region parameter write so readers in the home region find the ARN under the usual path.
      new CrossRegionParameter(this, "UsEast1CertParam", {
        region: props.homeRegion,
        name: paths.certUsEast1Arn(),
        value: this.certificate.certificateArn,
      });
    }
  }
}

export interface CrossRegionParameterProps {
  readonly region: string;
  readonly name: string;
  readonly value: string;
}

/** Writes an SSM String parameter into another region. */
export class CrossRegionParameter extends Construct {
  constructor(scope: Construct, id: string, props: CrossRegionParameterProps) {
    super(scope, id);
    const stack = Stack.of(this);
    const arn = stack.formatArn({
      service: "ssm",
      region: props.region,
      resource: "parameter",
      resourceName: props.name.replace(/^\//, ""),
    });
    new AwsCustomResource(this, "Resource", {
      resourceType: "Custom::CrossRegionParameter",
      onUpdate: {
        service: "SSM",
        action: "putParameter",
        region: props.region,
        parameters: { Name: props.name, Value: props.value, Type: "String", Overwrite: true },
        physicalResourceId: PhysicalResourceId.of(`${props.region}:${props.name}`),
      },
      onDelete: {
        service: "SSM",
        action: "deleteParameter",
        region: props.region,
        parameters: { Name: props.name },
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: [arn] }),
      installLatestAwsSdk: false,
    });
  }
}
