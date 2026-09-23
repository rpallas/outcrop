import { Match, Template } from "aws-cdk-lib/assertions";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { PlatformCustomResource } from "../src/constructs/custom-resource";
import { HANDLER_ENTRY, testStack } from "./fixtures";

describe("PlatformCustomResource", () => {
  it("shares one provider per handler and types properties", () => {
    const stack = testStack();
    const handler = PlatformCustomResource.handler(stack, "SeedHandler", {
      entry: HANDLER_ENTRY,
      policyStatements: [new PolicyStatement({ actions: ["ssm:GetParameter"], resources: ["*"] })],
    });
    const first = new PlatformCustomResource<{ Name: string }>(stack, "SeedA", {
      resourceType: "Custom::PlatformSeed",
      onEvent: handler,
      properties: { Name: "a" },
    });
    const second = new PlatformCustomResource<{ Name: string }>(stack, "SeedB", {
      resourceType: "Custom::PlatformSeed",
      onEvent: handler,
      properties: { Name: "b" },
    });
    expect(first.provider).toBe(second.provider);
    const template = Template.fromStack(stack);
    template.resourceCountIs("Custom::PlatformSeed", 2);
    template.hasResourceProperties("Custom::PlatformSeed", { Name: "a" });
    // handler + provider framework onEvent
    template.resourceCountIs("AWS::Lambda::Function", 2);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "orders-seed-handler",
      Timeout: 300,
    });
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          { Action: "ssm:GetParameter", Effect: "Allow", Resource: "*" },
        ]),
      },
    });
    // provider framework log group follows platform retention
    template.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 90 });
  });
});
