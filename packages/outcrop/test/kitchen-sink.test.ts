import { Aspects } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import { testApp, testConfig } from "./fixtures";
import { KitchenSinkStack } from "./kitchen-sink";

describe("kitchen sink", () => {
  it("synthesises for a base environment", () => {
    const stack = new KitchenSinkStack(testApp({ env: "dev" }), "KitchenSink");
    expect(stack.stackName).toBe("Orders");
    expect(Template.fromStack(stack).toJSON()).toMatchSnapshot();
  });

  it("synthesises for a preview", () => {
    const stack = new KitchenSinkStack(
      testApp({ preview: true, previewId: "abc-123", prNumber: "7" }),
      "KitchenSink",
    );
    expect(stack.stackName).toBe("abc-123-Orders");
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::ApiGatewayV2::DomainName", {
      DomainName: "orders-abc-123.dev.example.com",
    });
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TableName: "abc-123-orders-orders",
    });
    expect(template.toJSON()).toMatchSnapshot();
  });

  it("synthesises for shared isolation", () => {
    const stack = new KitchenSinkStack(
      testApp({ env: "dev", config: testConfig({ isolation: "shared" }) }),
      "KitchenSink",
    );
    expect(stack.stackName).toBe("Orders-dev");
    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "dev-orders-handler",
    });
  });

  it("passes cdk-nag AwsSolutions checks", () => {
    const app = testApp({ env: "dev" });
    const stack = new KitchenSinkStack(app, "KitchenSink");
    Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }));

    NagSuppressions.addStackSuppressions(stack, [
      {
        id: "AwsSolutions-IAM4",
        reason:
          "AWSLambdaBasicExecutionRole is the standard managed policy for Lambda logging and AmazonAPIGatewayPushToCloudWatchLogs is the only policy API Gateway accepts for its account-level logging role; log groups are explicit and scoped.",
        appliesTo: [
          "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs",
        ],
      },
      {
        id: "AwsSolutions-SF1",
        reason:
          "PlatformStateMachine logs ALL events in previews and ERROR elsewhere to keep vended log costs proportionate; `logLevel: LogLevel.ALL` opts in.",
      },
      {
        id: "AwsSolutions-SMG4",
        reason:
          "Rotation needs a consumer-specific rotation function; PlatformSecret keeps the standard `addRotationSchedule` for services that implement one.",
      },
      {
        id: "AwsSolutions-COG8",
        reason:
          "The Plus feature plan (threat protection) is billed per monthly active user; PlatformUserPool defaults to Essentials and `advancedSecurity: true` opts in.",
      },
      {
        id: "AwsSolutions-COG4",
        reason:
          "REST API methods use IAM authorization here; Cognito authorizers are one of several supported strategies, not a platform requirement.",
      },
    ]);
    // Dead letter queues attached to EventBridge rule and Scheduler targets are
    // not recognised by the SQS3 check (it only follows SQS redrive policies and Lambda DLQs).
    NagSuppressions.addResourceSuppressionsByPath(
      stack,
      ["/KitchenSink/OnOrderEventsDlq/Resource", "/KitchenSink/Nightly/Dlq/Resource"],
      [
        {
          id: "AwsSolutions-SQS3",
          reason: "The queue is the dead letter queue of an EventBridge rule or Scheduler target.",
        },
      ],
    );
    // Firehose rejects server-side encryption settings when the source is a
    // Kinesis stream; records are encrypted by the (KMS encrypted) source stream.
    NagSuppressions.addResourceSuppressionsByPath(stack, "/KitchenSink/ClicksArchive/Resource", [
      {
        id: "AwsSolutions-KDF1",
        reason:
          "Delivery streams with a Kinesis source cannot enable SSE; the source PlatformStream is KMS encrypted.",
      },
    ]);
    // WebSocket APIs can only authorize the $connect route (IAM here); the
    // remaining routes are reachable only over an authenticated connection.
    NagSuppressions.addResourceSuppressionsByPath(
      stack,
      [
        "/KitchenSink/Realtime/$disconnect-Route/Resource",
        "/KitchenSink/Realtime/$default-Route/Resource",
        "/KitchenSink/Realtime/subscribe-Route/Resource",
      ],
      [
        {
          id: "AwsSolutions-APIG4",
          reason:
            "WebSocket authorization is enforced on $connect; other routes cannot carry an authorizer.",
        },
      ],
    );
    NagSuppressions.addStackSuppressions(stack, [
      {
        id: "AwsSolutions-IAM5",
        reason:
          "Wildcards come from CDK grants (S3 object keys, DynamoDB index ARNs, X-Ray) and are scoped to the owning resource.",
      },
      {
        id: "AwsSolutions-L1",
        reason:
          "PlatformFunction defaults to the current Node LTS; the remaining findings are CDK-managed provider framework and bucket notification handlers.",
      },
      {
        id: "AwsSolutions-S1",
        reason:
          "Server access logging is opt-in via accessLogs; the account baseline provides the destination bucket.",
      },
    ]);

    const errors = Annotations.fromStack(stack).findError(
      "*",
      Match.stringLikeRegexp("AwsSolutions-.*"),
    );
    const messages = errors.map((e) => {
      const data = e.entry.data;
      return `${e.id}: ${typeof data === "string" ? data : JSON.stringify(data)}`;
    });
    expect(messages).toEqual([]);
  });
});
