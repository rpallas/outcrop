import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { type ISecret, Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Topic } from "aws-cdk-lib/aws-sns";
import { PlatformFunction } from "@rpallas/platform-cdk";
import { ChatOpsNotifier, type DestinationConfig } from "../src";
import { previewStack, testStack } from "./fixtures";

const destinationsEnv = (template: Template): DestinationConfig[] => {
  const functions = template.findResources("AWS::Lambda::Function", {
    Properties: { Environment: { Variables: { DESTINATIONS: Match.anyValue() } } },
  });
  const [fn] = Object.values(functions);
  const variables = (fn?.["Properties"] as { Environment: { Variables: Record<string, unknown> } })
    .Environment.Variables;
  const raw = variables["DESTINATIONS"];
  // The ARN references are tokens in the template; only the structure is asserted.
  return typeof raw === "string"
    ? (JSON.parse(raw) as DestinationConfig[])
    : (JSON.parse(joinFnJoin(raw)) as DestinationConfig[]);
};

/** Flatten a `Fn::Join` into a string, replacing intrinsic references with placeholders. */
const joinFnJoin = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "Fn::Join" in value) {
    const [separator, parts] = (value as { "Fn::Join": [string, unknown[]] })["Fn::Join"];
    return parts.map(joinFnJoin).join(separator);
  }
  return "arn:aws:secretsmanager:eu-west-1:111111111111:secret:placeholder";
};

describe("ChatOpsNotifier in a PlatformStack", () => {
  it("subscribes one PlatformFunction to the four alert topics by default", () => {
    const stack = testStack();
    const notifier = new ChatOpsNotifier(stack, "ChatOps", {
      destinations: [{ kind: "slack" }],
    });
    const template = Template.fromStack(stack);

    expect(notifier.handler).toBeInstanceOf(PlatformFunction);
    expect(notifier.topics).toHaveLength(4);
    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.resourceCountIs("AWS::SNS::Subscription", 4);
    template.resourceCountIs("AWS::Lambda::Permission", 4);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "orders-handler",
      Timeout: 30,
      DeadLetterConfig: { TargetArn: Match.anyValue() },
    });
    // DLQ and errors alarm
    template.resourceCountIs("AWS::SQS::Queue", 1);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-handler-errors",
    });
    // Topic ARNs come from the SSM contract
    for (const severity of ["critical", "high", "medium", "low"]) {
      template.hasParameter("*", { Default: `/platform/env/dev/alerts/topic-arn/${severity}` });
    }
    template.hasParameter("*", { Default: "/platform/secrets/slack-webhook/arn" });
  });

  it("filters default topics by severity and supports several destinations", () => {
    const stack = testStack();
    new ChatOpsNotifier(stack, "ChatOps", {
      severities: ["critical", "high"],
      destinations: [
        { kind: "slack", channelLabel: "#alerts" },
        { kind: "teams", minimumSeverity: "critical", webhookSecretName: "ops-teams" },
      ],
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::SNS::Subscription", 2);
    template.hasParameter("*", { Default: "/platform/secrets/ops-teams/arn" });

    const destinations = destinationsEnv(template);
    expect(destinations).toEqual([
      expect.objectContaining({ kind: "slack", minimumSeverity: "low", channelLabel: "#alerts" }),
      expect.objectContaining({ kind: "teams", minimumSeverity: "critical" }),
    ]);
    expect(destinations[0]?.webhookSecretArn).toMatch(/^arn:aws:secretsmanager:/);
    expect(destinations[1]).not.toHaveProperty("channelLabel");
  });

  it("uses explicit topics and secrets and grants read on each secret", () => {
    const stack = previewStack();
    const topic = new Topic(stack, "Custom");
    // Cast: `Secret` widens optional members with `undefined`, which exactOptionalPropertyTypes rejects.
    const secret = new Secret(stack, "Webhook") as ISecret;
    new ChatOpsNotifier(stack, "ChatOps", {
      topics: [topic],
      destinations: [{ kind: "teams", webhookSecret: secret }],
      deadLetterQueue: false,
      errorAlarm: false,
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::SNS::Subscription", 1);
    template.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "lambda",
      TopicArn: { Ref: Match.stringLikeRegexp("Custom") },
    });
    template.resourceCountIs("AWS::SQS::Queue", 0);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
            Resource: { Ref: Match.stringLikeRegexp("Webhook") },
          }),
        ]),
      },
    });
    const parameters = (template.toJSON()["Parameters"] ?? {}) as Record<
      string,
      { Default?: string }
    >;
    expect(Object.values(parameters).map((p) => p.Default)).not.toContain(
      "/platform/secrets/teams-webhook/arn",
    );
  });

  it("rejects empty destinations and severities with explicit topics", () => {
    const stack = testStack();
    expect(() => new ChatOpsNotifier(stack, "Empty", { destinations: [] })).toThrow(
      /at least one destination/,
    );
    expect(
      () =>
        new ChatOpsNotifier(stack, "Both", {
          topics: [new Topic(stack, "T")],
          severities: ["high"],
          destinations: [{ kind: "slack" }],
        }),
    ).toThrow(/severities/);
  });
});

describe("ChatOpsNotifier in a plain Stack", () => {
  const plainStack = (): Stack =>
    new Stack(new App({ context: { "aws:cdk:bundling-stacks": [] } }), "Baseline", {
      env: { account: "111111111111", region: "eu-west-1" },
    });

  it("creates a NodejsFunction with explicit topics and secrets", () => {
    const stack = plainStack();
    const topic = new Topic(stack, "Critical", { topicName: "platform-dev-alerts-critical" });
    const secret = new Secret(stack, "Webhook") as ISecret;
    const notifier = new ChatOpsNotifier(stack, "ChatOps", {
      topics: [topic],
      destinations: [{ kind: "slack", webhookSecret: secret, channelLabel: "#ops" }],
    });
    const template = Template.fromStack(stack);

    expect(notifier.handler).not.toBeInstanceOf(PlatformFunction);
    expect(notifier.errorAlarm).toBeUndefined();
    expect(notifier.deadLetterQueue).toBeDefined();
    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
      DeadLetterConfig: { TargetArn: Match.anyValue() },
      Environment: { Variables: { DESTINATIONS: Match.anyValue() } },
    });
    template.resourceCountIs("AWS::SNS::Subscription", 1);
    template.resourceCountIs("AWS::SQS::Queue", 1);
    template.resourceCountIs("AWS::Logs::LogGroup", 1);
  });

  it("requires explicit topics and secrets", () => {
    const stack = plainStack();
    expect(
      () => new ChatOpsNotifier(stack, "NoTopics", { destinations: [{ kind: "slack" }] }),
    ).toThrow(/pass `topics` explicitly/);
    expect(
      () =>
        new ChatOpsNotifier(stack, "NoSecret", {
          topics: [new Topic(stack, "T")],
          destinations: [{ kind: "teams" }],
        }),
    ).toThrow(/pass `webhookSecret`/);
  });
});
