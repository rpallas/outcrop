import { Aspects } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import { AccountBaselineStack, createAccountBaseline } from "../src/account-baseline-stack";
import { testAccountConfig, testApp } from "./fixtures";

const fullModules = {
  githubOidc: true,
  accountSettings: true,
  dns: true,
  alerting: true,
  eventBus: { allowOrganizationId: "o-example" },
  encryption: true,
  sharedParameters: { values: { "auth0-domain": "example.eu.auth0.com" } },
  sharedSecrets: { secrets: { "neon-api-key": {} } },
  budgets: true,
  security: true,
  network: true,
  logRetention: true,
} as const;

describe("AccountBaselineStack", () => {
  it("names the stack, targets the environment and wires modules together", () => {
    const app = testApp("dev");
    const { baseline, edge } = createAccountBaseline(app, {
      config: testAccountConfig(),
      modules: fullModules,
    });
    expect(baseline.stackName).toBe("PlatformAccount-dev");
    expect(baseline.account).toBe("111111111111");
    expect(baseline.region).toBe("eu-west-1");
    expect(edge?.stackName).toBe("PlatformAccountEdge-dev");
    expect(edge?.region).toBe("us-east-1");

    const template = Template.fromStack(baseline);
    // Alert topics use the platform key; budgets notify the high topic.
    template.hasResourceProperties("AWS::SNS::Topic", {
      TopicName: "platform-dev-alerts-high",
      KmsMasterKeyId: Match.anyValue(),
    });
    template.hasResourceProperties("AWS::Budgets::Budget", {
      NotificationsWithSubscribers: Match.arrayWith([
        Match.objectLike({
          Subscribers: Match.arrayWith([Match.objectLike({ SubscriptionType: "SNS" })]),
        }),
      ]),
    });
    template.hasResourceProperties("AWS::SSM::Parameter", { Name: "/platform/account/id" });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/env/dev/name",
      Value: "dev",
    });
    expect(Object.keys(template.findOutputs("*", { Value: "dev" }))).toHaveLength(1);

    const edgeTemplate = Template.fromStack(edge!);
    edgeTemplate.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: "dev.example.com",
    });
    edgeTemplate.resourceCountIs("Custom::CrossRegionParameter", 1);
    const edgeJson = JSON.stringify(edgeTemplate.toJSON());
    expect(edgeJson).toContain("/platform/env/dev/certs/us-east-1-arn");
    expect(edgeJson).toContain('\\"region\\":\\"eu-west-1\\"');
  });

  it("skips the edge stack in us-east-1 and writes the parameter directly", () => {
    const app = testApp("global");
    const { baseline, edge } = createAccountBaseline(app, {
      config: testAccountConfig(),
      modules: { dns: true },
    });
    expect(edge).toBeUndefined();
    Template.fromStack(baseline).hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/env/global/certs/regional-arn",
    });
  });

  it("protects production", () => {
    const app = testApp("prod");
    const stack = new AccountBaselineStack(app, "Baseline", {
      config: testAccountConfig(),
      modules: { encryption: true, dns: true },
    });
    expect(stack.terminationProtection).toBe(true);
    const template = Template.fromStack(stack);
    template.hasResource("AWS::KMS::Key", { DeletionPolicy: "Retain" });
    template.hasResource("AWS::Route53::HostedZone", { DeletionPolicy: "Retain" });
  });

  it("matches the snapshot", () => {
    const app = testApp("dev");
    const { baseline } = createAccountBaseline(app, {
      config: testAccountConfig(),
      modules: fullModules,
    });
    expect(Template.fromStack(baseline).toJSON()).toMatchSnapshot();
  });

  it("passes cdk-nag AwsSolutions checks", () => {
    const app = testApp("dev");
    const { baseline } = createAccountBaseline(app, {
      config: testAccountConfig(),
      modules: fullModules,
    });
    Aspects.of(baseline).add(new AwsSolutionsChecks({ verbose: true }));
    NagSuppressions.addStackSuppressions(baseline, [
      {
        id: "AwsSolutions-IAM4",
        reason:
          "AWS managed policies for the Config service role and the AwsCustomResource/Lambda basic execution roles.",
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "Wildcards are limited to CloudFormation describe calls, log groups in this account and account-level settings that have no resource ARN.",
      },
      {
        id: "AwsSolutions-L1",
        reason:
          "Inline account helpers pin a supported LTS runtime; provider framework runtimes are owned by the CDK.",
      },
      {
        id: "AwsSolutions-S1",
        reason:
          "The audit bucket is the destination for access logs; logging it to itself would recurse.",
      },
      {
        id: "AwsSolutions-SMG4",
        reason:
          "Shared secrets hold third-party API keys whose rotation is owned by the provider; values are replaced out of band.",
      },
    ]);
    app.synth();
    const errors = Annotations.fromStack(baseline).findError(
      "*",
      Match.stringLikeRegexp("AwsSolutions-.*"),
    );
    expect(errors.map((e) => JSON.stringify(e.entry.data))).toEqual([]);
  });
});
