import { Duration } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { DefinitionBody, Pass } from "aws-cdk-lib/aws-stepfunctions";
import { PlatformEventBus } from "../src/constructs/event-bus";
import { PlatformEventRule } from "../src/constructs/event-rule";
import { PlatformFunction } from "../src/constructs/function";
import { PlatformQueue } from "../src/constructs/queue";
import { PlatformStateMachine } from "../src/constructs/state-machine";
import { PlatformTopic } from "../src/constructs/topic";
import { HANDLER_ENTRY, testStack } from "./fixtures";

describe("PlatformEventRule", () => {
  it("maps event names to detail types on the platform bus and wires targets", () => {
    const stack = testStack();
    const fn = new PlatformFunction(stack, "Handler", { entry: HANDLER_ENTRY });
    const queue = new PlatformQueue(stack, "Inbox");
    const topic = new PlatformTopic(stack, "Fanout", { encryption: false });
    const machine = new PlatformStateMachine(stack, "Flow", {
      definitionBody: DefinitionBody.fromChainable(new Pass(stack, "Done")),
    });
    const rule = new PlatformEventRule(stack, "OnOrderEvents", {
      eventNames: ["order.created", "order.updated"],
      source: "checkout",
      targets: [fn, queue, topic, machine],
      deadLetterQueue: true,
      retryAttempts: 3,
      maxEventAge: Duration.hours(1),
    });
    rule.alarms.failedInvocations();
    rule.alarms.deadLetter();

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Events::Rule", {
      Name: "orders-on-order-events",
      EventBusName: Match.anyValue(),
      EventPattern: {
        "detail-type": ["order.created", "order.updated"],
        source: ["checkout"],
      },
      Targets: Match.arrayWith([
        Match.objectLike({
          Arn: Match.objectLike({ "Fn::GetAtt": Match.arrayWith(["Arn"]) }),
          DeadLetterConfig: Match.anyValue(),
          RetryPolicy: { MaximumRetryAttempts: 3, MaximumEventAgeInSeconds: 3600 },
        }),
      ]),
    });
    const targets = template.findResources("AWS::Events::Rule");
    const targetCount = Object.values(targets).map(
      (r) => (r["Properties"] as { Targets: unknown[] }).Targets.length,
    );
    expect(targetCount).toEqual([4]);
    template.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "orders-on-order-events-dlq",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-on-order-events-failed-invocations",
      Dimensions: Match.arrayWith([{ Name: "RuleName", Value: Match.anyValue() }]),
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-on-order-events-dead-letter",
    });
    expect(rule.dashboardWidgets()).toHaveLength(2);
  });

  it("uses a custom bus and explicit pattern", () => {
    const stack = testStack();
    const bus = new PlatformEventBus(stack, "Bus");
    const fn = new PlatformFunction(stack, "Handler", { entry: HANDLER_ENTRY });
    const rule = new PlatformEventRule(stack, "Custom", {
      eventBus: bus,
      eventPattern: { detail: { status: ["shipped"] } },
      detailType: ["shipment"],
      targets: [fn],
    });
    expect(() => rule.alarms.deadLetter()).toThrow(/deadLetterQueue/);
    Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
      EventBusName: { Ref: Match.stringLikeRegexp("Bus") },
      EventPattern: { detail: { status: ["shipped"] }, "detail-type": ["shipment"] },
    });
  });

  it("requires a pattern", () => {
    const stack = testStack();
    const fn = new PlatformFunction(stack, "Handler", { entry: HANDLER_ENTRY });
    expect(() => new PlatformEventRule(stack, "Empty", { targets: [fn] })).toThrow(
      /needs eventNames/,
    );
  });
});
