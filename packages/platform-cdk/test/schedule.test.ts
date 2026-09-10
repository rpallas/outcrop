import { Duration } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ScheduleExpression } from "aws-cdk-lib/aws-scheduler";
import { PlatformFunction } from "../src/constructs/function";
import { PlatformQueue } from "../src/constructs/queue";
import { parseScheduleExpression, PlatformSchedule } from "../src/constructs/schedule";
import { HANDLER_ENTRY, previewStack, testStack } from "./fixtures";

describe("PlatformSchedule", () => {
  it("creates a cron schedule with group, input, dlq and alarm", () => {
    const stack = testStack();
    const fn = new PlatformFunction(stack, "Job", { entry: HANDLER_ENTRY });
    const schedule = new PlatformSchedule(stack, "Nightly", {
      schedule: "cron(0 2 * * ? *)",
      target: fn,
      input: { job: "cleanup" },
      timezone: "Europe/London",
      deadLetterQueue: true,
      flexibleTimeWindow: Duration.minutes(15),
    });
    schedule.alarms.failedInvocations();

    expect(schedule.enabled).toBe(true);
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Scheduler::ScheduleGroup", { Name: "orders-nightly" });
    template.hasResourceProperties("AWS::Scheduler::Schedule", {
      Name: "orders-nightly",
      ScheduleExpression: "cron(0 2 * * ? *)",
      ScheduleExpressionTimezone: "Europe/London",
      State: "ENABLED",
      FlexibleTimeWindow: { Mode: "FLEXIBLE", MaximumWindowInMinutes: 15 },
      Target: Match.objectLike({
        Input: '{"job":"cleanup"}',
        DeadLetterConfig: Match.anyValue(),
      }),
    });
    template.hasResourceProperties("AWS::SQS::Queue", { QueueName: "orders-nightly-dlq" });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-nightly-failed-invocations",
      Namespace: "AWS/Scheduler",
      MetricName: "TargetErrorCount",
    });
    expect(schedule.dashboardWidgets()).toHaveLength(2);
  });

  it("is disabled in previews unless runInPreview", () => {
    const stack = previewStack();
    const queue = new PlatformQueue(stack, "Jobs");
    new PlatformSchedule(stack, "Tick", { schedule: "rate(5 minutes)", target: queue });
    new PlatformSchedule(stack, "Live", {
      schedule: ScheduleExpression.rate(Duration.hours(1)),
      target: queue,
      runInPreview: true,
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Scheduler::Schedule", {
      Name: "abc-123-orders-tick",
      State: "DISABLED",
      ScheduleExpression: "rate(5 minutes)",
    });
    template.hasResourceProperties("AWS::Scheduler::Schedule", {
      Name: "abc-123-orders-live",
      State: "ENABLED",
      ScheduleExpression: "rate(1 hour)",
    });
  });

  it("rejects malformed expressions", () => {
    expect(() => parseScheduleExpression("every day")).toThrow(/Invalid schedule expression/);
    expect(parseScheduleExpression("rate(1 minute)").expressionString).toBe("rate(1 minute)");
  });
});
