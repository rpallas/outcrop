import path from "node:path";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { PlatformPythonFunction } from "../src/constructs/python-function";
import { previewStack, PYTHON_ENTRY, testStack } from "./fixtures";

describe("PlatformPythonFunction", () => {
  it("applies the platform defaults and the standard alarms", () => {
    const stack = testStack();
    const fn = new PlatformPythonFunction(stack, "Report", {
      entry: PYTHON_ENTRY,
      deadLetterQueue: true,
      environment: { TABLE_NAME: "orders" },
    });
    const alarms = fn.addStandardAlarms();

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "orders-report",
      Runtime: "python3.13",
      Handler: "index.handler",
      Architectures: ["arm64"],
      MemorySize: 1024,
      Timeout: 10,
      TracingConfig: { Mode: "Active" },
      LoggingConfig: {
        LogFormat: "JSON",
        ApplicationLogLevel: "INFO",
        SystemLogLevel: "INFO",
      },
      DeadLetterConfig: { TargetArn: Match.anyValue() },
      Environment: {
        Variables: Match.objectLike({
          PLATFORM_SERVICE: "orders",
          PLATFORM_ENV: "dev",
          PLATFORM_FUNCTION: "report",
          POWERTOOLS_LOG_LEVEL: "INFO",
          LOG_LEVEL: "info",
          TABLE_NAME: "orders",
        }),
      },
    });
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/aws/lambda/orders-report",
      RetentionInDays: 90,
    });
    template.hasResourceProperties("AWS::SQS::Queue", { QueueName: "orders-report-dlq" });
    expect(alarms).toHaveLength(4);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-report-duration",
      Threshold: 8000,
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-report-dead-letters",
    });
    expect(fn.dashboardWidgets()).toHaveLength(3);
  });

  it("supports custom module, handler, runtime and debug logging in previews", () => {
    const stack = previewStack();
    const fn = new PlatformPythonFunction(stack, "Report", {
      entry: PYTHON_ENTRY,
      index: "app/main.py",
      handler: "lambda_handler",
      runtime: Runtime.PYTHON_3_12,
    });
    expect(fn.logLevel).toBe("debug");
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "abc-123-orders-report",
      Runtime: "python3.12",
      Handler: "app.main.lambda_handler",
      LoggingConfig: Match.objectLike({ ApplicationLogLevel: "DEBUG" }),
      Environment: {
        Variables: Match.objectLike({ PLATFORM_PREVIEW_ID: "abc-123", LOG_LEVEL: "debug" }),
      },
    });
    template.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 7 });
  });

  it("rejects a missing entry directory", () => {
    const stack = testStack();
    expect(
      () =>
        new PlatformPythonFunction(stack, "Missing", { entry: path.join(PYTHON_ENTRY, "nope") }),
    ).toThrow(/does not exist/);
  });
});
