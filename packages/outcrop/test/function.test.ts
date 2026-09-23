import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Duration } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { lambdaEntry, PlatformFunction } from "../src/constructs/function";
import { HANDLER_ENTRY, previewStack, testStack } from "./fixtures";

describe("PlatformFunction", () => {
  it("applies platform defaults", () => {
    const stack = testStack();
    new PlatformFunction(stack, "OrdersHandler", { entry: HANDLER_ENTRY });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "orders-orders-handler",
      Architectures: ["arm64"],
      Runtime: "nodejs24.x",
      MemorySize: 1024,
      Timeout: 10,
      TracingConfig: { Mode: "Active" },
      LoggingConfig: {
        LogFormat: "Text",
        LogGroup: { Ref: Match.stringLikeRegexp("OrdersHandlerLogGroup") },
      },
      Environment: {
        Variables: Match.objectLike({
          NODE_OPTIONS: "--enable-source-maps",
          POWERTOOLS_SERVICE_NAME: "orders",
          POWERTOOLS_LOG_LEVEL: "INFO",
          LOG_LEVEL: "info",
          PLATFORM_ENV: "dev",
          PLATFORM_SERVICE: "orders",
          PLATFORM_SSM_ROOT: "/platform",
          PLATFORM_FUNCTION: "orders-handler",
        }),
      },
    });
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/aws/lambda/orders-orders-handler",
      RetentionInDays: 90,
    });
  });

  it("preview functions log at debug with one week retention and preview id", () => {
    const stack = previewStack();
    new PlatformFunction(stack, "Handler", { entry: HANDLER_ENTRY });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "abc-123-orders-handler",
      Environment: {
        Variables: Match.objectLike({
          LOG_LEVEL: "debug",
          PLATFORM_PREVIEW_ID: "abc-123",
          POWERTOOLS_LOGGER_LOG_EVENT: "true",
        }),
      },
    });
    template.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 7 });
    template.hasResource("AWS::Logs::LogGroup", { DeletionPolicy: "Delete" });
  });

  it("supports json log format and custom levels", () => {
    const stack = testStack();
    new PlatformFunction(stack, "Handler", {
      entry: HANDLER_ENTRY,
      logging: { format: "json", level: "warn" },
    });
    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
      LoggingConfig: Match.objectLike({
        LogFormat: "JSON",
        ApplicationLogLevel: "WARN",
        SystemLogLevel: "INFO",
      }),
      Environment: { Variables: Match.objectLike({ POWERTOOLS_LOG_LEVEL: "WARN" }) },
    });
  });

  it("creates a dead letter queue on request", () => {
    const stack = testStack();
    const fn = new PlatformFunction(stack, "Worker", {
      entry: HANDLER_ENTRY,
      deadLetterQueue: true,
    });
    fn.alarms.deadLetters();
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "orders-worker-dlq",
      MessageRetentionPeriod: 1209600,
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      DeadLetterConfig: {
        TargetArn: { "Fn::GetAtt": [Match.stringLikeRegexp("WorkerDlq"), "Arn"] },
      },
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-worker-dead-letters",
    });
  });

  it("accepts an existing dead letter queue", () => {
    const stack = testStack();
    const dlq = new Queue(stack, "Existing");
    new PlatformFunction(stack, "Worker", { entry: HANDLER_ENTRY, deadLetterQueue: dlq });
    Template.fromStack(stack).resourceCountIs("AWS::SQS::Queue", 1);
  });

  it("deadLetters alarm requires a dlq", () => {
    const stack = testStack();
    const fn = new PlatformFunction(stack, "Worker", { entry: HANDLER_ENTRY });
    expect(() => fn.alarms.deadLetters()).toThrow(/requires deadLetterQueue/);
  });

  it("creates standard alarms", () => {
    const stack = testStack();
    const fn = new PlatformFunction(stack, "Handler", {
      entry: HANDLER_ENTRY,
      timeout: Duration.seconds(30),
    });
    const alarms = fn.addStandardAlarms();
    expect(alarms).toHaveLength(3);
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-handler-errors",
      MetricName: "Errors",
      Statistic: "Sum",
      Threshold: 1,
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-handler-throttles",
      MetricName: "Throttles",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-handler-duration",
      ExtendedStatistic: "p99",
      Threshold: 24000,
      EvaluationPeriods: 3,
    });
  });

  it("enables insights on request", () => {
    const stack = testStack();
    new PlatformFunction(stack, "Handler", { entry: HANDLER_ENTRY, insights: true });
    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
      Layers: Match.arrayWith([Match.stringLikeRegexp("LambdaInsightsExtension")]),
    });
  });

  it("merges custom environment and honours overrides", () => {
    const stack = testStack();
    new PlatformFunction(stack, "Handler", {
      entry: HANDLER_ENTRY,
      name: "api",
      memorySize: 256,
      environment: { TABLE_NAME: "t", LOG_LEVEL: "error" },
    });
    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "orders-api",
      MemorySize: 256,
      Environment: { Variables: Match.objectLike({ TABLE_NAME: "t", LOG_LEVEL: "error" }) },
    });
  });

  it("lambdaEntry resolves ts files and fails clearly", () => {
    expect(lambdaEntry(path.join(__dirname, "fixtures", "handler"))).toBe(HANDLER_ENTRY);
    expect(() => lambdaEntry(path.join(__dirname, "fixtures", "missing"))).toThrow(
      /No Lambda entry found/,
    );
  });

  it("bundles library handlers that live outside the consumer project root", () => {
    // Simulates a symlinked package (workspaces, npm link): the handler's real
    // path is outside the directory holding the consumer's lock file.
    const libraryRoot = mkdtempSync(path.join(tmpdir(), "outcrop-lib-"));
    writeFileSync(path.join(libraryRoot, "package-lock.json"), "{}");
    const pkg = path.join(libraryRoot, "node_modules", "example-lib");
    mkdirSync(path.join(pkg, "dist"), { recursive: true });
    writeFileSync(path.join(pkg, "package.json"), '{"name":"example-lib"}');
    const entry = path.join(pkg, "dist", "handler.js");
    writeFileSync(entry, "exports.handler = async () => ({});");

    const stack = testStack();
    expect(() => new PlatformFunction(stack, "LibHandler", { entry })).not.toThrow();
    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "orders-lib-handler",
    });
  });
});
