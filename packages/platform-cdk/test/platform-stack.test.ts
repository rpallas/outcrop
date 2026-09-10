import { App, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { PlatformApp } from "../src/core/platform-app";
import { PlatformStack } from "../src/core/platform-stack";
import { previewStack, testApp, testConfig, testStack } from "./fixtures";

describe("PlatformApp", () => {
  it("exposes context, naming and paths", () => {
    const app = testApp({ env: "dev" });
    expect(app.context.env).toBe("dev");
    expect(app.naming.stack()).toBe("Orders");
    expect(app.paths.account.kmsKeyArn()).toBe("/platform/account/kms/key-arn");
    expect(PlatformApp.of(new PlatformStack(app, "S"))).toBe(app);
  });

  it("PlatformApp.of throws outside a PlatformApp", () => {
    expect(() => PlatformApp.of(new Stack(new App(), "S"))).toThrow(/not inside a PlatformApp/);
  });
});

describe("PlatformStack", () => {
  it("derives stack name, env and description", () => {
    const stack = testStack();
    expect(stack.stackName).toBe("Orders");
    expect(stack.account).toBe("111111111111");
    expect(stack.region).toBe("eu-west-1");
    expect(stack.templateOptions.description).toContain("orders");
    expect(stack.removalPolicy).toBe(RemovalPolicy.DESTROY);
    expect(stack.logRetention).toBe(RetentionDays.THREE_MONTHS);
    expect(stack.isPreview).toBe(false);
    expect(stack.domainName).toBe("orders.dev.example.com");
    expect(stack.alerts.enabled).toBe(true);
  });

  it("supports a name suffix", () => {
    const app = testApp();
    expect(new PlatformStack(app, "Api", { name: "api" }).stackName).toBe("OrdersApi");
  });

  it("preview stacks are prefixed, destructible and quiet", () => {
    const stack = previewStack("abc-123");
    expect(stack.stackName).toBe("abc-123-Orders");
    expect(stack.isPreview).toBe(true);
    expect(stack.previewId).toBe("abc-123");
    expect(stack.removalPolicy).toBe(RemovalPolicy.DESTROY);
    expect(stack.logRetention).toBe(RetentionDays.ONE_WEEK);
    expect(stack.domainName).toBe("orders-abc-123.dev.example.com");
    expect(stack.alerts.enabled).toBe(false);
  });

  it("applies platform tags to resources", () => {
    const stack = testStack({ preview: true, previewId: "abc-123", prNumber: "42" });
    new Topic(stack, "T");
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::SNS::Topic", {
      Tags: [
        { Key: "platform:env", Value: "dev" },
        { Key: "platform:managed-by", Value: "platform-cdk" },
        { Key: "platform:pr-number", Value: "42" },
        { Key: "platform:preview-id", Value: "abc-123" },
        { Key: "platform:project", Value: "Example Platform" },
        { Key: "platform:repository", Value: "example-org/orders" },
        { Key: "platform:service", Value: "orders" },
      ],
    });
  });

  it("applies custom tags", () => {
    const stack = testStack({ config: testConfig({ tags: { team: "payments" } }) });
    new Topic(stack, "T");
    Template.fromStack(stack).hasResourceProperties("AWS::SNS::Topic", {
      Tags: Match.arrayWith([{ Key: "team", Value: "payments" }]),
    });
  });

  it("works inside a plain cdk.App when given a config", () => {
    const app = new App({ context: { env: "dev" } });
    const stack = new PlatformStack(app, "S", { config: testConfig() });
    expect(stack.stackName).toBe("Orders");
    expect(PlatformStack.of(stack)).toBe(stack);
  });

  it("requires a config outside a PlatformApp", () => {
    expect(() => new PlatformStack(new App(), "S")).toThrow(/needs a config/);
  });

  it("PlatformStack.of throws for plain stacks", () => {
    expect(() => PlatformStack.of(new Stack(new App(), "S"))).toThrow(/not inside a PlatformStack/);
    expect(PlatformStack.isPlatformStack(new Stack(new App(), "S"))).toBe(false);
  });

  it("shared isolation suffixes the env", () => {
    const stack = testStack({ config: testConfig({ isolation: "shared" }) });
    expect(stack.stackName).toBe("Orders-dev");
    expect(stack.naming.resource("sqsQueue", "jobs")).toBe("dev-orders-jobs");
  });
});
