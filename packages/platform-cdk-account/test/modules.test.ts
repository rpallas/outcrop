import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { resolveAccountEnv } from "../src/context";
import { AccountSettings } from "../src/modules/account-settings";
import { Alerting } from "../src/modules/alerting";
import { Budgets } from "../src/modules/budgets";
import { Dns } from "../src/modules/dns";
import { Encryption } from "../src/modules/encryption";
import { EventBusModule } from "../src/modules/event-bus";
import { GitHubOidc } from "../src/modules/github-oidc";
import { LogRetention } from "../src/modules/log-retention";
import { Network } from "../src/modules/network";
import { Security } from "../src/modules/security";
import { SharedParameters, SharedSecrets } from "../src/modules/shared";
import { testAccountConfig, testApp } from "./fixtures";

const stackFor = (env = "dev"): { stack: Stack; context: ReturnType<typeof resolveAccountEnv> } => {
  const app = testApp(env);
  const config = testAccountConfig();
  const environment = config.environments[env];
  if (!environment) throw new Error(`unknown env ${env}`);
  const stack = new Stack(app, "Test", {
    env: { account: environment.account, region: environment.region },
  });
  return { stack, context: resolveAccountEnv(stack, config) };
};

describe("GitHubOidc", () => {
  it("creates a provider and least-privilege roles per repository", () => {
    const { stack, context } = stackFor();
    const oidc = new GitHubOidc(stack, "Oidc", { context });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::IAM::OIDCProvider", 1);
    template.resourceCountIs("AWS::IAM::Role", 4);
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "platform-dev-deploy-example-org-orders",
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
              StringLike: {
                "token.actions.githubusercontent.com:sub": [
                  "repo:example-org/orders:environment:dev",
                  "repo:example-org/orders:pull_request",
                ],
              },
            },
          }),
        ],
      },
    });
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "platform-dev-deploy-example-org-hello-http",
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Condition: Match.objectLike({
              StringLike: {
                "token.actions.githubusercontent.com:sub": Match.arrayWith([
                  "repo:example-org/hello-http:ref:refs/heads/main",
                ]),
              },
            }),
          }),
        ],
      },
    });
    // Deploy roles only assume the CDK bootstrap roles.
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "platform-dev-deploy-example-org-orders",
      Policies: [
        {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Sid: "AssumeCdkBootstrapRoles",
                Action: "sts:AssumeRole",
                Resource: Match.anyValue(),
              }),
            ]),
          },
        },
      ],
    });
    expect(JSON.stringify(template.toJSON())).toContain(
      "cdk-hnb659fds-deploy-role-111111111111-eu-west-1",
    );
    expect(JSON.stringify(template.toJSON())).toContain(
      "cdk-hnb659fds-lookup-role-111111111111-eu-west-1",
    );
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/account/deploy/role-arn/orders",
    });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/account/deploy/readonly-role-arn/orders",
    });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/account/deploy/oidc-provider-arn",
    });
    expect(oidc.deployRoleFor("example-org", "orders")).toBeDefined();
    expect(oidc.deployRoleFor("example-org", "nope")).toBeUndefined();
  });

  it("never allows pull requests into protected environments", () => {
    const { stack, context } = stackFor("prod");
    new GitHubOidc(stack, "Oidc", {
      context,
      existingProviderArn:
        "arn:aws:iam::222222222222:oidc-provider/token.actions.githubusercontent.com",
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::IAM::OIDCProvider", 0);
    const roles = template.findResources("AWS::IAM::Role");
    const subjects = JSON.stringify(roles);
    expect(subjects).toContain("repo:example-org/orders:environment:prod");
    // Read-only roles may still be used from pull requests for `cdk diff`.
    const readOnlyRole = Object.values(roles).find((r) =>
      JSON.stringify(r).includes("platform-prod-readonly-"),
    );
    expect(JSON.stringify(readOnlyRole)).toContain("pull_request");
    const deployRole = Object.values(roles).find((r) =>
      JSON.stringify(r).includes("platform-prod-deploy-"),
    );
    expect(JSON.stringify(deployRole)).not.toContain("pull_request");
  });
});

describe("AccountSettings", () => {
  it("creates custom resources and an access analyzer", () => {
    const { stack, context } = stackFor();
    new AccountSettings(stack, "Settings", { context });
    const template = Template.fromStack(stack);
    template.resourceCountIs("Custom::IamAccountAlias", 1);
    template.resourceCountIs("Custom::IamPasswordPolicy", 1);
    template.resourceCountIs("Custom::S3AccountPublicAccessBlock", 1);
    template.resourceCountIs("Custom::EbsEncryptionByDefault", 1);
    template.hasResourceProperties("AWS::AccessAnalyzer::Analyzer", { Type: "ACCOUNT" });
    template.hasResourceProperties("Custom::IamAccountAlias", {
      Create: Match.serializedJson(
        Match.objectLike({ parameters: { AccountAlias: "example-platform-dev" } }),
      ),
    });
  });

  it("can be trimmed down", () => {
    const { stack, context } = stackFor();
    new AccountSettings(stack, "Settings", {
      context,
      alias: false,
      passwordPolicy: false,
      accessAnalyzer: false,
      ebsEncryptionByDefault: false,
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs("Custom::IamAccountAlias", 0);
    template.resourceCountIs("Custom::S3AccountPublicAccessBlock", 1);
    template.resourceCountIs("AWS::AccessAnalyzer::Analyzer", 0);
  });
});

describe("Dns", () => {
  it("creates the zone, certificate and parameters", () => {
    const { stack, context } = stackFor();
    const dns = new Dns(stack, "Dns", { context });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Route53::HostedZone", { Name: "dev.example.com." });
    template.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: "dev.example.com",
      SubjectAlternativeNames: ["*.dev.example.com"],
      ValidationMethod: "DNS",
    });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/env/dev/dns/zone-id",
    });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/env/dev/certs/regional-arn",
    });
    template.hasOutput("*", { Description: "NS records to create for dev.example.com" });
    expect(dns.domain).toBe("dev.example.com");
  });

  it("delegates from a parent zone in the same account", () => {
    const { stack, context } = stackFor();
    new Dns(stack, "Dns", {
      context: {
        ...context,
        environment: {
          ...context.environment,
          parentZone: { hostedZoneId: "Z123", zoneName: "example.com" },
        },
      },
    });
    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "NS",
      Name: "dev.example.com.",
      HostedZoneId: "Z123",
    });
  });

  it("delegates cross-account with a role", () => {
    const { stack, context } = stackFor();
    new Dns(stack, "Dns", {
      context: {
        ...context,
        environment: {
          ...context.environment,
          parentZone: {
            hostedZoneId: "Z123",
            zoneName: "example.com",
            delegationRoleArn: "arn:aws:iam::333333333333:role/delegation",
          },
        },
      },
    });
    Template.fromStack(stack).resourceCountIs("Custom::CrossAccountZoneDelegation", 1);
  });

  it("requires a domain", () => {
    const { stack, context } = stackFor();
    expect(
      () =>
        new Dns(stack, "Dns", {
          context: { ...context, environment: { ...context.environment, domain: undefined } },
        }),
    ).toThrow(/no domain/);
  });
});

describe("Alerting", () => {
  it("creates a topic per severity with parameters and subscriptions", () => {
    const { stack, context } = stackFor();
    const encryption = new Encryption(stack, "Encryption", { context });
    const alerting = new Alerting(stack, "Alerting", { context, kmsKey: encryption.key });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::SNS::Topic", 4);
    template.resourceCountIs("AWS::SNS::Subscription", 4);
    template.hasResourceProperties("AWS::SNS::Topic", {
      TopicName: "platform-dev-alerts-critical",
      KmsMasterKeyId: Match.anyValue(),
      Tags: Match.arrayWith([{ Key: "platform:severity", Value: "critical" }]),
    });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/env/dev/alerts/topic-arn/high",
    });
    template.hasResourceProperties("AWS::SNS::TopicPolicy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Sid: "AllowAwsServicesToPublish", Action: "sns:Publish" }),
        ]),
      },
    });
    expect(alerting.topic("low")).toBe(alerting.topics.low);
  });
});

describe("Encryption", () => {
  it("creates a rotating key with alias and service access", () => {
    const { stack, context } = stackFor();
    new Encryption(stack, "Encryption", { context, allowOrganizationId: "o-example" });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::KMS::Key", { EnableKeyRotation: true });
    template.hasResourceProperties("AWS::KMS::Alias", { AliasName: "alias/platform-dev-key" });
    template.hasResourceProperties("AWS::KMS::Key", {
      KeyPolicy: {
        Statement: Match.arrayWith([
          Match.objectLike({ Sid: "AllowCloudWatchLogs" }),
          Match.objectLike({ Sid: "AllowOrganization" }),
        ]),
      },
    });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/account/kms/key-arn",
    });
  });
});

describe("EventBusModule", () => {
  it("creates the bus, archive, policies and parameters", () => {
    const { stack, context } = stackFor();
    new EventBusModule(stack, "Events", {
      context,
      allowOrganizationId: "o-example",
      allowAccountIds: ["333333333333"],
      logAllEvents: true,
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Events::EventBus", { Name: "platform-dev-events" });
    template.resourceCountIs("AWS::Events::Archive", 1);
    template.resourceCountIs("AWS::Events::EventBusPolicy", 2);
    template.resourceCountIs("AWS::Events::Rule", 1);
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/env/dev/events/bus-name",
      Value: Match.anyValue(),
    });
  });
});

describe("SharedParameters and SharedSecrets", () => {
  it("publishes config values and secret arns", () => {
    const { stack, context } = stackFor();
    new SharedParameters(stack, "Params", {
      context,
      values: {
        "auth0-domain": "example.eu.auth0.com",
        "allowed-origins": ["https://a.example.com", "https://b.example.com"],
      },
    });
    new SharedSecrets(stack, "Secrets", {
      context,
      secrets: {
        "neon-api-key": { description: "Neon API key" },
        "slack-webhook": {
          existingArn: "arn:aws:secretsmanager:eu-west-1:111111111111:secret:slack-webhook-AbCdEf",
        },
      },
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/config/auth0-domain",
      Value: "example.eu.auth0.com",
    });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/config/allowed-origins",
      Type: "StringList",
    });
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "platform-dev-neon-api-key",
      GenerateSecretString: Match.objectLike({ PasswordLength: 32 }),
    });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/secrets/neon-api-key/arn",
    });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/secrets/slack-webhook/arn",
      Value: "arn:aws:secretsmanager:eu-west-1:111111111111:secret:slack-webhook-AbCdEf",
    });
  });

  it("validates names", () => {
    const { stack, context } = stackFor();
    expect(() => new SharedSecrets(stack, "S", { context, secrets: { Bad_Name: {} } })).toThrow(
      /kebab-case/,
    );
    expect(() => new SharedParameters(stack, "P", { context, values: { "bad key": "x" } })).toThrow(
      /must match/,
    );
  });
});

describe("Budgets", () => {
  it("creates notifications to topic and email", () => {
    const { stack, context } = stackFor();
    const alerting = new Alerting(stack, "Alerting", { context });
    new Budgets(stack, "Budgets", { context, topic: alerting.topic("high") });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Budgets::Budget", {
      Budget: {
        BudgetLimit: { Amount: 100, Unit: "USD" },
        TimeUnit: "MONTHLY",
        BudgetType: "COST",
      },
      NotificationsWithSubscribers: Match.arrayWith([
        Match.objectLike({
          Notification: Match.objectLike({ NotificationType: "FORECASTED", Threshold: 100 }),
          Subscribers: Match.arrayWith([
            { SubscriptionType: "EMAIL", Address: "alerts@example.com" },
          ]),
        }),
      ]),
    });
  });

  it("requires an amount", () => {
    const { stack, context } = stackFor("prod");
    expect(() => new Budgets(stack, "Budgets", { context, emails: ["a@example.com"] })).toThrow(
      /no budget amount/,
    );
  });
});

describe("Security", () => {
  it("enables CloudTrail, Config, GuardDuty and Security Hub", () => {
    const { stack, context } = stackFor();
    new Security(stack, "Security", { context });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::CloudTrail::Trail", {
      IsMultiRegionTrail: true,
      EnableLogFileValidation: true,
    });
    template.resourceCountIs("AWS::Config::ConfigurationRecorder", 1);
    template.resourceCountIs("AWS::Config::DeliveryChannel", 1);
    template.hasResourceProperties("AWS::GuardDuty::Detector", { Enable: true });
    template.resourceCountIs("AWS::SecurityHub::Hub", 1);
    template.resourceCountIs("AWS::SecurityHub::Standard", 1);
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketName: "platform-dev-audit-111111111111",
      VersioningConfiguration: { Status: "Enabled" },
    });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/account/security/cloudtrail-bucket-name",
    });
  });

  it("skips services managed elsewhere", () => {
    const { stack, context } = stackFor();
    new Security(stack, "Security", {
      context,
      cloudTrail: false,
      config: false,
      guardDuty: false,
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::S3::Bucket", 0);
    template.resourceCountIs("AWS::GuardDuty::Detector", 0);
    template.resourceCountIs("AWS::SecurityHub::Hub", 1);
  });
});

describe("Network", () => {
  it("creates an isolated VPC with endpoints by default", () => {
    const { stack, context } = stackFor();
    new Network(stack, "Network", { context });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::EC2::NatGateway", 0);
    template.resourceCountIs("AWS::EC2::Subnet", 2);
    template.resourceCountIs("AWS::EC2::VPCEndpoint", 12);
    template.hasResourceProperties("AWS::SSM::Parameter", { Name: "/platform/account/vpc/id" });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/account/vpc/private-subnet-ids",
      Type: "StringList",
    });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/account/vpc/lambda-security-group-id",
    });
    template.resourceCountIs("AWS::EC2::FlowLog", 1);
  });

  it("adds public subnets and NAT when requested", () => {
    const { stack, context } = stackFor();
    new Network(stack, "Network", {
      context,
      natGateways: 1,
      flowLogs: false,
      interfaceEndpoints: [],
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::EC2::NatGateway", 1);
    template.resourceCountIs("AWS::EC2::Subnet", 4);
    template.resourceCountIs("AWS::EC2::VPCEndpoint", 2);
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/account/vpc/public-subnet-ids",
    });
  });
});

describe("LogRetention", () => {
  it("creates the sweeper with schedule and CloudTrail rule", () => {
    const { stack, context } = stackFor();
    new LogRetention(stack, "LogRetention", { context, excludePrefixes: ["/aws/vendedlogs"] });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "platform-dev-log-retention",
      Environment: { Variables: { RETENTION_DAYS: "90", EXCLUDE_PREFIXES: "/aws/vendedlogs" } },
    });
    template.resourceCountIs("AWS::Events::Rule", 2);
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/account/log-retention-days",
      Value: "90",
    });
  });
});
