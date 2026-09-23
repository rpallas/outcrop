import {
  FlowLogDestination,
  FlowLogTrafficType,
  GatewayVpcEndpointAwsService,
  InterfaceVpcEndpointAwsService,
  type IVpc,
  IpAddresses,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { ResourceKind } from "@rpallas/outcrop";
import { Construct } from "constructs";
import {
  type BaselineModuleProps,
  baselineRemovalPolicy,
  output,
  publishListParameter,
  publishParameter,
} from "./base";

export interface NetworkProps extends BaselineModuleProps {
  /** VPC CIDR. Default 10.0.0.0/16. */
  readonly cidr?: string;
  /** Number of availability zones. Default 2. */
  readonly maxAzs?: number;
  /**
   * NAT gateways for private subnets. Default 0: Lambda functions reach AWS
   * services through VPC endpoints and have no internet access, which is the
   * cheapest and safest default. Set to 1 or more when functions call the internet.
   */
  readonly natGateways?: number;
  /** Interface endpoints to create. Defaults to the services the platform uses. */
  readonly interfaceEndpoints?: InterfaceVpcEndpointAwsService[];
  /** Flow logs to CloudWatch Logs. Default true. */
  readonly flowLogs?: boolean;
}

export const DEFAULT_INTERFACE_ENDPOINTS: InterfaceVpcEndpointAwsService[] = [
  InterfaceVpcEndpointAwsService.SSM,
  InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
  InterfaceVpcEndpointAwsService.KMS,
  InterfaceVpcEndpointAwsService.SQS,
  InterfaceVpcEndpointAwsService.SNS,
  InterfaceVpcEndpointAwsService.EVENTBRIDGE,
  InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
  InterfaceVpcEndpointAwsService.CLOUDWATCH_MONITORING,
  InterfaceVpcEndpointAwsService.STS,
  InterfaceVpcEndpointAwsService.LAMBDA,
];

/**
 * Opt-in VPC for Lambda functions that must reach private resources: private
 * subnets (isolated by default, private-with-egress when `natGateways > 0`),
 * gateway endpoints for S3 and DynamoDB, interface endpoints for the platform
 * services, a shared Lambda security group and flow logs. Published under
 * `/platform/account/vpc/*` for `PlatformFunction({ vpc: true })`.
 */
export class Network extends Construct {
  readonly vpc: IVpc;
  readonly lambdaSecurityGroup: SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkProps) {
    super(scope, id);
    const { context } = props;
    const natGateways = props.natGateways ?? 0;
    const privateType =
      natGateways > 0 ? SubnetType.PRIVATE_WITH_EGRESS : SubnetType.PRIVATE_ISOLATED;

    // Cast: `Vpc` widens optional members with `undefined`, which exactOptionalPropertyTypes rejects.
    const vpc = new Vpc(this, "Vpc", {
      vpcName: context.naming.resource(ResourceKind.Generic, "vpc"),
      ipAddresses: IpAddresses.cidr(props.cidr ?? "10.0.0.0/16"),
      maxAzs: props.maxAzs ?? 2,
      natGateways,
      subnetConfiguration: [
        ...(natGateways > 0
          ? [{ name: "public", subnetType: SubnetType.PUBLIC, cidrMask: 24 }]
          : []),
        { name: "private", subnetType: privateType, cidrMask: 20 },
      ],
      gatewayEndpoints: {
        S3: { service: GatewayVpcEndpointAwsService.S3 },
        DynamoDb: { service: GatewayVpcEndpointAwsService.DYNAMODB },
      },
    }) as IVpc;
    this.vpc = vpc;

    const endpointSecurityGroup = new SecurityGroup(this, "EndpointSecurityGroup", {
      vpc: this.vpc,
      description: "VPC interface endpoints",
      allowAllOutbound: false,
    });
    endpointSecurityGroup.addIngressRule(
      Peer.ipv4(this.vpc.vpcCidrBlock),
      Port.tcp(443),
      "HTTPS from the VPC",
    );
    for (const service of props.interfaceEndpoints ?? DEFAULT_INTERFACE_ENDPOINTS) {
      this.vpc.addInterfaceEndpoint(`${service.shortName.replace(/[^a-zA-Z0-9]/g, "")}Endpoint`, {
        service,
        securityGroups: [endpointSecurityGroup],
        subnets: { subnetType: privateType },
      });
    }

    this.lambdaSecurityGroup = new SecurityGroup(this, "LambdaSecurityGroup", {
      vpc: this.vpc,
      securityGroupName: context.naming.resource(ResourceKind.Generic, "lambda"),
      description: "Shared security group for platform Lambda functions",
      allowAllOutbound: true,
    });

    if (props.flowLogs !== false) {
      const logGroup = new LogGroup(this, "FlowLogs", {
        logGroupName: `/${context.naming.resource(ResourceKind.LogGroup, "vpc-flow-logs")}`,
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: baselineRemovalPolicy(context),
      });
      this.vpc.addFlowLog("FlowLog", {
        destination: FlowLogDestination.toCloudWatchLogs(logGroup),
        trafficType: FlowLogTrafficType.REJECT,
      });
    }

    const account = context.paths.account;
    const privateSubnets = this.vpc.selectSubnets({ subnetType: privateType }).subnetIds;
    publishParameter(this, "VpcIdParam", account.vpcId(), this.vpc.vpcId);
    publishParameter(this, "VpcCidrParam", account.vpcCidr(), this.vpc.vpcCidrBlock);
    publishListParameter(
      this,
      "PrivateSubnetsParam",
      account.vpcPrivateSubnetIds(),
      privateSubnets,
    );
    publishListParameter(
      this,
      "AvailabilityZonesParam",
      account.vpcAvailabilityZones(),
      this.vpc.availabilityZones,
    );
    if (natGateways > 0) {
      publishListParameter(
        this,
        "PublicSubnetsParam",
        account.vpcPublicSubnetIds(),
        this.vpc.publicSubnets.map((s) => s.subnetId),
      );
    }
    publishParameter(
      this,
      "LambdaSecurityGroupParam",
      account.vpcLambdaSecurityGroupId(),
      this.lambdaSecurityGroup.securityGroupId,
    );
    output(this, "VpcId", this.vpc.vpcId);
  }
}
