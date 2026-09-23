import { Match, Template } from "aws-cdk-lib/assertions";
import { PlatformRestApi } from "../src/constructs/rest-api";
import { PlatformWebAcl } from "../src/constructs/web-acl";
import { testConfig, testStack } from "./fixtures";

describe("PlatformWebAcl", () => {
  it("creates a regional ACL with managed rules, rate limit and association", () => {
    const stack = testStack();
    const acl = new PlatformWebAcl(stack, "Firewall", {
      rateLimit: 500,
      commonRuleSetCountOverrides: ["SizeRestrictions_BODY"],
    });
    const api = new PlatformRestApi(stack, "Api", { outputs: false });
    api.root.addMethod("GET");
    acl.associate(api.deploymentStage);
    acl.alarms.blockedRequests({ threshold: 10 });

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::WAFv2::WebACL", {
      Name: "orders-firewall",
      Scope: "REGIONAL",
      DefaultAction: { Allow: {} },
      VisibilityConfig: Match.objectLike({ CloudWatchMetricsEnabled: true }),
      Rules: [
        Match.objectLike({
          Name: "AWS-AWSManagedRulesCommonRuleSet",
          Priority: 10,
          Statement: {
            ManagedRuleGroupStatement: Match.objectLike({
              RuleActionOverrides: [{ Name: "SizeRestrictions_BODY", ActionToUse: { Count: {} } }],
            }),
          },
        }),
        Match.objectLike({ Name: "AWS-AWSManagedRulesKnownBadInputsRuleSet", Priority: 20 }),
        Match.objectLike({ Name: "AWS-AWSManagedRulesAmazonIpReputationList", Priority: 30 }),
        Match.objectLike({
          Name: "RateLimitPerIp",
          Statement: { RateBasedStatement: { Limit: 500, AggregateKeyType: "IP" } },
        }),
      ],
    });
    template.hasResourceProperties("AWS::WAFv2::WebACLAssociation", {
      ResourceArn: {
        "Fn::Join": [
          "",
          Match.arrayWith([Match.stringLikeRegexp(":apigateway:eu-west-1::/restapis/")]),
        ],
      },
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-firewall-blocked-requests",
      Namespace: "AWS/WAFV2",
      Threshold: 10,
      Dimensions: Match.arrayWith([{ Name: "Region", Value: "eu-west-1" }]),
    });
    expect(acl.dashboardWidgets()).toHaveLength(1);
  });

  it("requires us-east-1 for CloudFront scope", () => {
    expect(() => PlatformWebAcl.forDistribution(testStack(), "Edge")).toThrow(/us-east-1/);

    const edge = testStack({
      config: testConfig({
        environments: { dev: { account: "111111111111", region: "us-east-1" } },
      }),
    });
    const acl = PlatformWebAcl.forDistribution(edge, "Edge", { rateLimit: false });
    expect(() => acl.associate("arn:aws:apigateway:us-east-1::/restapis/abc/stages/dev")).toThrow(
      /Distribution.webAclId/,
    );
    Template.fromStack(edge).hasResourceProperties("AWS::WAFv2::WebACL", {
      Scope: "CLOUDFRONT",
      Rules: Match.not(Match.arrayWith([Match.objectLike({ Name: "RateLimitPerIp" })])),
    });
  });
});
