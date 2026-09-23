import { Duration } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { PlatformEventBus } from "../src/constructs/event-bus";
import { PlatformFunction } from "../src/constructs/function";
import { HANDLER_ENTRY, testStack } from "./fixtures";

describe("PlatformEventBus", () => {
  it("creates a named bus with archive, grants and alarm", () => {
    const stack = testStack();
    const bus = new PlatformEventBus(stack, "Domain", {
      archive: { retention: Duration.days(30) },
    });
    const fn = new PlatformFunction(stack, "Publisher", { entry: HANDLER_ENTRY });
    bus.grantPutEvents(fn);
    bus.alarms.failedInvocations();

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Events::EventBus", { Name: "orders-domain" });
    template.hasResourceProperties("AWS::Events::Archive", { RetentionDays: 30 });
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([Match.objectLike({ Action: "events:PutEvents" })]),
      }),
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-domain-failed-invocations",
      Namespace: "AWS/Events",
      MetricName: "FailedInvocations",
      Dimensions: [{ Name: "EventBusName", Value: Match.anyValue() }],
    });
    expect(bus.eventArchive).toBeDefined();
    expect(bus.dashboardWidgets()).toHaveLength(2);
  });

  it("imports the environment bus from the SSM contract", () => {
    const stack = testStack();
    const bus = PlatformEventBus.fromPlatform(stack);
    expect(PlatformEventBus.fromPlatform(stack)).toBe(bus);
    Template.fromStack(stack).hasParameter("*", {
      Type: "AWS::SSM::Parameter::Value<String>",
      Default: "/platform/env/dev/events/bus-arn",
    });
  });
});
