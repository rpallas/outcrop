import { Match, Template } from "aws-cdk-lib/assertions";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { PlatformDistribution } from "../src/constructs/distribution";
import { previewStack, testConfig, testStack } from "./fixtures";

const origin = new HttpOrigin("origin.example.com");

describe("PlatformDistribution", () => {
  it("creates a distribution with domain, aliases, logs, outputs and alarms", () => {
    const stack = testStack();
    const cdn = new PlatformDistribution(stack, "Cdn", { defaultBehavior: { origin } });
    cdn.alarms.serverErrors();
    cdn.alarms.clientErrors();

    expect(cdn.url).toBe("https://orders.dev.example.com");
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Aliases: ["orders.dev.example.com"],
        Comment: "orders-cdn",
        HttpVersion: "http2and3",
        ViewerCertificate: Match.objectLike({
          MinimumProtocolVersion: "TLSv1.2_2021",
          SslSupportMethod: "sni-only",
          AcmCertificateArn: Match.stringLikeRegexp("us-east-1"),
        }),
        Logging: Match.objectLike({ Prefix: "cdn/" }),
      }),
    });
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketName: "orders-cdn-cf-logs",
      OwnershipControls: { Rules: [{ ObjectOwnership: "ObjectWriter" }] },
    });
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Name: "orders.dev.example.com.",
      Type: "A",
      AliasTarget: Match.objectLike({ HostedZoneId: Match.anyValue() }),
    });
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Name: "orders.dev.example.com.",
      Type: "AAAA",
    });
    template.hasOutput("CdnDomainName", { Value: "orders.dev.example.com" });
    template.hasOutput("CdnUrl", { Value: "https://orders.dev.example.com" });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-cdn-5xx-rate",
      MetricName: "5xxErrorRate",
      Threshold: 1,
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-cdn-4xx-rate",
      MetricName: "4xxErrorRate",
    });
    expect(cdn.dashboardWidgets()).toHaveLength(3);
  });

  it("uses the preview hostname and skips logs in previews", () => {
    const stack = previewStack();
    const cdn = new PlatformDistribution(stack, "Cdn", { defaultBehavior: { origin } });
    expect(cdn.hostname).toBe("orders-abc-123.dev.example.com");
    expect(cdn.logBucket).toBeUndefined();
    Template.fromStack(stack).hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Aliases: ["orders-abc-123.dev.example.com"],
        Logging: Match.absent(),
      }),
    });
  });

  it("supports disableDomain, domainPattern and environments without a domain", () => {
    const stack = testStack();
    new PlatformDistribution(stack, "NoDomain", {
      defaultBehavior: { origin },
      disableDomain: true,
      accessLogs: false,
      outputs: false,
    });
    const assets = new PlatformDistribution(stack, "Assets", {
      defaultBehavior: { origin },
      domainPattern: "assets-{service}.{envDomain}",
      accessLogs: false,
    });
    expect(assets.hostname).toBe("assets-orders.dev.example.com");
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Route53::RecordSet", 2);
    template.resourceCountIs("AWS::S3::Bucket", 0);

    const bare = testStack({
      config: testConfig({
        environments: { dev: { account: "111111111111", region: "eu-west-1" } },
      }),
    });
    const cdn = new PlatformDistribution(bare, "Cdn", {
      defaultBehavior: { origin },
      accessLogs: false,
    });
    expect(cdn.hostname).toBeUndefined();
    expect(cdn.url).toContain("${Token[");
    Template.fromStack(bare).hasOutput("CdnUrl", {});
  });
});
