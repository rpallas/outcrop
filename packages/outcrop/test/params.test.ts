import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Function as LambdaFunction, InlineCode, Runtime } from "aws-cdk-lib/aws-lambda";
import { PlatformParameterPaths } from "../src/params/paths";
import { PlatformParameters } from "../src/params/parameters";
import { testConfig, testStack } from "./fixtures";

describe("PlatformParameterPaths", () => {
  const paths = new PlatformParameterPaths("/platform/");

  it("builds account paths", () => {
    expect(paths.account.id()).toBe("/platform/account/id");
    expect(paths.account.kmsKeyArn()).toBe("/platform/account/kms/key-arn");
    expect(paths.account.deployRoleArn("orders")).toBe("/platform/account/deploy/role-arn/orders");
    expect(paths.account.vpcPrivateSubnetIds()).toBe("/platform/account/vpc/private-subnet-ids");
  });

  it("builds env paths", () => {
    const env = paths.env("dev");
    expect(env.dnsZoneId()).toBe("/platform/env/dev/dns/zone-id");
    expect(env.certRegionalArn()).toBe("/platform/env/dev/certs/regional-arn");
    expect(env.certUsEast1Arn()).toBe("/platform/env/dev/certs/us-east-1-arn");
    expect(env.alertTopicArn("high")).toBe("/platform/env/dev/alerts/topic-arn/high");
    expect(env.eventBusName()).toBe("/platform/env/dev/events/bus-name");
  });

  it("builds shared paths", () => {
    expect(paths.config("feature-flags")).toBe("/platform/config/feature-flags");
    expect(paths.secretArn("auth0")).toBe("/platform/secrets/auth0/arn");
    expect(paths.service("orders", "api-url")).toBe("/platform/services/orders/api-url");
  });

  it("supports custom roots", () => {
    expect(new PlatformParameterPaths("/acme/plat").account.id()).toBe("/acme/plat/account/id");
  });
});

describe("PlatformParameters", () => {
  it("deploy-time values become SSM-typed CloudFormation parameters", () => {
    const stack = testStack();
    const arn = stack.params.env.alertTopicArn("critical");
    new LambdaFunction(stack, "F", {
      runtime: Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: InlineCode.fromInline("x"),
      environment: { TOPIC: arn },
    });
    const template = Template.fromStack(stack);
    const parameters = template.toJSON()["Parameters"] as Record<
      string,
      { Type: string; Default: string }
    >;
    const ssmParam = Object.values(parameters).find(
      (p) => p.Default === "/platform/env/dev/alerts/topic-arn/critical",
    );
    expect(ssmParam?.Type).toBe("AWS::SSM::Parameter::Value<String>");
  });

  it("synth-time lookups use the placeholder default in tests", () => {
    const stack = testStack();
    expect(stack.params.env.dnsZoneId()).toBe("Z0000000000000000000A");
    expect(stack.params.env.dnsZoneName()).toBe("dev.example.com");
    expect(stack.params.env.certificateArn()).toMatch(
      /^arn:aws:acm:eu-west-1:111111111111:certificate\//,
    );
    expect(stack.params.env.usEast1CertificateArn()).toMatch(/^arn:aws:acm:us-east-1:/);
  });

  it("caches imported constructs", () => {
    const stack = testStack();
    expect(stack.params.env.hostedZone()).toBe(stack.params.env.hostedZone());
    expect(stack.params.env.alertTopic("high")).toBe(stack.params.env.alertTopic("high"));
    expect(stack.params.account.kmsKey()).toBe(stack.params.account.kmsKey());
    expect(stack.params.env.eventBus()).toBe(stack.params.env.eventBus());
    expect(stack.params.secret("auth0")).toBe(stack.params.secret("auth0"));
  });

  it("imports the account VPC", () => {
    const stack = testStack();
    const vpc = stack.params.account.vpc();
    expect(vpc.privateSubnets).toHaveLength(2);
    expect(vpc.publicSubnets).toHaveLength(2);
    expect(vpc.availabilityZones).toEqual(["eu-west-1a", "eu-west-1b"]);
  });

  it("refuses synth-time lookups without a concrete account", () => {
    const app = new App({ context: { env: "dev" } });
    const stack = new Stack(app, "S");
    const params = new PlatformParameters(stack, { env: "dev" });
    expect(() => params.env.dnsZoneId()).toThrow(/no concrete account\/region/);
  });

  it("uses the configured root prefix", () => {
    const stack = testStack({ config: testConfig({ ssmRootPrefix: "/acme" }) });
    expect(stack.params.paths.env("dev").eventBusArn()).toBe("/acme/env/dev/events/bus-arn");
  });

  it("cross-region values use a custom resource", () => {
    const stack = testStack();
    const value = stack.params.crossRegionValue(
      "EdgeCert",
      "/platform/env/dev/certs/us-east-1-arn",
      "us-east-1",
    );
    expect(value).toBeDefined();
    Template.fromStack(stack).hasResourceProperties("Custom::AWS", {
      Create: Match.serializedJson(
        Match.objectLike({ service: "SSM", action: "getParameter", region: "us-east-1" }),
      ),
    });
  });
});
