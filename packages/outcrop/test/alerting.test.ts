import { Duration } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { Topic } from "aws-cdk-lib/aws-sns";
import { alertTopic, PlatformAlarm } from "../src/alerting/alarm";
import { PlatformDashboard } from "../src/alerting/dashboard";
import { previewStack, testStack } from "./fixtures";

const metric = new Metric({
  namespace: "Example",
  metricName: "Errors",
  period: Duration.minutes(1),
});

describe("PlatformAlarm", () => {
  it("names, tags and routes alarms by severity", () => {
    const stack = testStack();
    new PlatformAlarm(stack, "Errors", {
      name: "handler-errors",
      severity: "high",
      metric,
      threshold: 1,
      evaluationPeriods: 1,
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-handler-errors",
      AlarmDescription: "[high] orders: handler-errors",
      TreatMissingData: "notBreaching",
      AlarmActions: [
        { Ref: Match.stringLikeRegexp("SsmParameterValueplatformenvdevalertstopicarnhigh") },
      ],
      OKActions: [{ Ref: Match.anyValue() }],
      Tags: Match.arrayWith([{ Key: "platform:severity", Value: "high" }]),
    });
  });

  it("stays quiet in preview stacks", () => {
    const stack = previewStack();
    new PlatformAlarm(stack, "Errors", {
      name: "e",
      severity: "critical",
      metric,
      threshold: 1,
      evaluationPeriods: 1,
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "abc-123-orders-e",
      AlarmActions: Match.absent(),
    });
  });

  it("routes to an explicit topic even in previews", () => {
    const stack = previewStack();
    const topic = new Topic(stack, "T");
    new PlatformAlarm(stack, "Errors", {
      name: "e",
      severity: "low",
      metric,
      threshold: 1,
      evaluationPeriods: 1,
      topic,
      notifyOnOk: false,
    });
    Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmActions: [{ Ref: Match.stringLikeRegexp("^T") }],
      OKActions: Match.absent(),
    });
  });

  it("alertTopic imports from the SSM contract", () => {
    const stack = testStack();
    expect(alertTopic(stack, "medium")).toBe(stack.params.env.alertTopic("medium"));
  });
});

describe("PlatformDashboard", () => {
  it("builds rows", () => {
    const stack = testStack();
    const alarm = new PlatformAlarm(stack, "A", {
      name: "a",
      severity: "low",
      metric,
      threshold: 1,
      evaluationPeriods: 1,
    });
    new PlatformDashboard(stack, "D")
      .addHeader("# Orders")
      .addMetricRow([
        { title: "Errors", left: [metric] },
        { title: "More", left: [metric], right: [metric] },
      ])
      .addAlarmRow("Alarms", [alarm])
      .addRow();
    Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Dashboard", {
      DashboardName: "orders-overview",
    });
  });
});
