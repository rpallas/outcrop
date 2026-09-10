import { Match, Template } from "aws-cdk-lib/assertions";
import { Key } from "aws-cdk-lib/aws-kms";
import { PlatformFunction } from "../src/constructs/function";
import { PlatformQueue } from "../src/constructs/queue";
import { PlatformTopic } from "../src/constructs/topic";
import { HANDLER_ENTRY, previewStack, testStack } from "./fixtures";

describe("PlatformTopic", () => {
  it("encrypts with the account key, enforces SSL and names the topic", () => {
    const stack = testStack();
    const topic = new PlatformTopic(stack, "OrderEvents");
    const fn = new PlatformFunction(stack, "Handler", { entry: HANDLER_ENTRY });
    const queue = new PlatformQueue(stack, "Inbox");
    topic.addLambdaSubscription(fn);
    topic.addQueueSubscription(queue, { rawMessageDelivery: false });
    topic.alarms.failedNotifications();

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::SNS::Topic", {
      TopicName: "orders-order-events",
      KmsMasterKeyId: Match.anyValue(),
    });
    template.hasResourceProperties("AWS::SNS::TopicPolicy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Deny",
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          }),
        ]),
      }),
    });
    template.hasResourceProperties("AWS::SNS::Subscription", { Protocol: "lambda" });
    template.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "sqs",
      RawMessageDelivery: false,
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-order-events-failed-notifications",
      MetricName: "NumberOfNotificationsFailed",
      Namespace: "AWS/SNS",
    });
    expect(topic.dashboardWidgets()).toHaveLength(2);
  });

  it("supports disabling encryption, explicit keys and fifo topics", () => {
    const stack = previewStack();
    new PlatformTopic(stack, "Plain", { encryption: false });
    new PlatformTopic(stack, "Custom", { encryption: new Key(stack, "Key"), name: "audit.fifo" });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::SNS::Topic", {
      TopicName: "abc-123-orders-plain",
      KmsMasterKeyId: Match.absent(),
    });
    template.hasResourceProperties("AWS::SNS::Topic", {
      TopicName: "abc-123-orders-audit.fifo",
      FifoTopic: true,
      KmsMasterKeyId: { "Fn::GetAtt": [Match.stringLikeRegexp("Key"), "Arn"] },
    });
  });
});
