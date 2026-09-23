import { Duration } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { DefinitionBody, LogLevel, Pass } from "aws-cdk-lib/aws-stepfunctions";
import { PlatformStateMachine } from "../src/constructs/state-machine";
import { previewStack, testStack } from "./fixtures";

describe("PlatformStateMachine", () => {
  it("enables tracing and ERROR logging with platform naming", () => {
    const stack = testStack();
    const machine = new PlatformStateMachine(stack, "OrderFlow", {
      definitionBody: DefinitionBody.fromChainable(new Pass(stack, "Start")),
      timeout: Duration.minutes(10),
    });
    machine.alarms.failed();
    machine.alarms.timedOut();
    machine.alarms.throttled();
    machine.alarms.duration();

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
      StateMachineName: "orders-order-flow",
      TracingConfiguration: { Enabled: true },
      LoggingConfiguration: Match.objectLike({ Level: "ERROR", IncludeExecutionData: false }),
    });
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/aws/vendedlogs/states/orders-order-flow",
      RetentionInDays: 90,
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-order-flow-failed",
      MetricName: "ExecutionsFailed",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-order-flow-duration",
      MetricName: "ExecutionTime",
      Threshold: 480000,
      ExtendedStatistic: "p99",
    });
    template.resourceCountIs("AWS::CloudWatch::Alarm", 4);
    expect(machine.dashboardWidgets()).toHaveLength(3);
  });

  it("logs everything in previews and honours overrides", () => {
    const stack = previewStack();
    new PlatformStateMachine(stack, "Flow", {
      definitionBody: DefinitionBody.fromChainable(new Pass(stack, "Start")),
    });
    new PlatformStateMachine(stack, "Quiet", {
      definitionBody: DefinitionBody.fromChainable(new Pass(stack, "Start2")),
      logLevel: LogLevel.FATAL,
      tracing: false,
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
      StateMachineName: "abc-123-orders-flow",
      LoggingConfiguration: Match.objectLike({ Level: "ALL", IncludeExecutionData: true }),
    });
    template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
      StateMachineName: "abc-123-orders-quiet",
      TracingConfiguration: { Enabled: false },
      LoggingConfiguration: Match.objectLike({ Level: "FATAL" }),
    });
    template.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 7 });
  });
});
