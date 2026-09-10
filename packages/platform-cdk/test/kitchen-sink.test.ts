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
          "AWSLambdaBasicExecutionRole is the standard managed policy for Lambda logging; log groups are explicit and scoped.",
        appliesTo: [
          "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
        ],
      },
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
