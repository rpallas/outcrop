import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { SNSEvent, SNSEventRecord } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import {
  createHandler,
  type DestinationConfig,
  parseDestinations,
  parseWebhookUrl,
  postWebhook,
} from "../src/handlers/notify";
import {
  alarmConsoleUrl,
  formatMessage,
  parseAlarmMessage,
  parseAlarmName,
  parseBudgetMessage,
  parseEventBridgeMessage,
  severityFromTopicArn,
  slackPayload,
  teamsPayload,
} from "../src/message-templates";

const secretsMock = mockClient(SecretsManagerClient);

const TOPIC_CRITICAL = "arn:aws:sns:eu-west-1:111111111111:platform-dev-alerts-critical";
const TOPIC_LOW = "arn:aws:sns:eu-west-1:111111111111:platform-dev-alerts-low";
const SLACK_SECRET =
  "arn:aws:secretsmanager:eu-west-1:111111111111:secret:platform-dev-slack-webhook-AbC";
const TEAMS_SECRET =
  "arn:aws:secretsmanager:eu-west-1:111111111111:secret:platform-dev-teams-webhook-DeF";
const SLACK_URL = "https://hooks.example.com/services/T000/B000/XXXX";
const TEAMS_URL = "https://hooks.example.com/webhookb2/0000/IncomingWebhook/1111";

const alarmMessage = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    AlarmName: "orders-api-errors",
    AlarmDescription: "[high] orders: api-errors",
    AWSAccountId: "111111111111",
    Region: "EU (Ireland)",
    NewStateValue: "ALARM",
    OldStateValue: "OK",
    NewStateReason:
      "Threshold Crossed: 1 datapoint [3.0] was greater than or equal to the threshold (1.0).",
    StateChangeTime: "2026-09-10T20:00:00.000+0000",
    Trigger: {
      MetricName: "Errors",
      Namespace: "AWS/Lambda",
      Statistic: "SUM",
      Threshold: 1,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      Dimensions: [{ name: "FunctionName", value: "orders-api" }],
    },
    ...overrides,
  });

const BUDGET_MESSAGE = `AWS Budget Notification September 10, 2026
AWS Account 111111111111

Dear AWS Customer,

You requested that we alert you when the ACTUAL Cost associated with your platform-dev-monthly budget is greater than $80.00 for the current month. The ACTUAL Cost associated with this budget is $85.12. You can find additional details below and by accessing the AWS Budgets dashboard.

Budget Name: platform-dev-monthly
Budget Type: Cost
Budgeted Amount: $100.00`;

const record = (
  message: string,
  options: { topicArn?: string; subject?: string; attributes?: Record<string, string> } = {},
): SNSEventRecord => ({
  EventSource: "aws:sns",
  EventVersion: "1.0",
  EventSubscriptionArn: `${options.topicArn ?? TOPIC_CRITICAL}:00000000-0000-0000-0000-000000000000`,
  Sns: {
    Type: "Notification",
    MessageId: "00000000-0000-0000-0000-000000000000",
    TopicArn: options.topicArn ?? TOPIC_CRITICAL,
    Subject: options.subject ?? "",
    Message: message,
    Timestamp: "2026-09-10T20:00:01.000Z",
    SignatureVersion: "1",
    Signature: "",
    SigningCertUrl: "",
    UnsubscribeUrl: "",
    MessageAttributes: Object.fromEntries(
      Object.entries(options.attributes ?? {}).map(([k, v]) => [k, { Type: "String", Value: v }]),
    ),
  },
});

const snsEvent = (...records: SNSEventRecord[]): SNSEvent => ({ Records: records });

interface WebhookCall {
  url: string;
  payload: Record<string, unknown>;
}

const fakeFetch = (
  responder: (call: WebhookCall, attempt: number) => Response | Error,
): { fetch: typeof fetch; calls: WebhookCall[] } => {
  const calls: WebhookCall[] = [];
  const attempts = new Map<string, number>();
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const payload = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
      string,
      unknown
    >;
    const call = { url, payload };
    calls.push(call);
    const attempt = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, attempt);
    const result = responder(call, attempt);
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
};

const ok = (): Response => new Response("ok", { status: 200 });
const status = (code: number): Response => new Response("err", { status: code });
const noSleep = (): Promise<void> => Promise.resolve();

const destinations: DestinationConfig[] = [
  {
    kind: "slack",
    webhookSecretArn: SLACK_SECRET,
    minimumSeverity: "low",
    channelLabel: "#alerts",
  },
  { kind: "teams", webhookSecretArn: TEAMS_SECRET, minimumSeverity: "high" },
];

describe("parsing", () => {
  it("parses CloudWatch alarm notifications", () => {
    const alarm = parseAlarmMessage(alarmMessage());
    expect(alarm?.AlarmName).toBe("orders-api-errors");
    expect(alarm?.NewStateValue).toBe("ALARM");
    expect(parseAlarmMessage("not json")).toBeUndefined();
    expect(parseAlarmMessage(JSON.stringify({ foo: 1 }))).toBeUndefined();
  });

  it("parses budget notifications", () => {
    const budget = parseBudgetMessage(BUDGET_MESSAGE);
    expect(budget).toMatchObject({
      budgetName: "platform-dev-monthly",
      accountId: "111111111111",
      thresholdText: "greater than $80.00",
      actualText: "$85.12",
    });
    expect(parseBudgetMessage("hello")).toBeUndefined();
    expect(
      parseBudgetMessage(
        "body",
        "AWS Budgets: platform-dev-monthly has exceeded your alert threshold",
      )?.budgetName,
    ).toBe("platform-dev-monthly");
  });

  it("parses EventBridge events", () => {
    const event = parseEventBridgeMessage(
      JSON.stringify({
        source: "aws.health",
        "detail-type": "AWS Health Event",
        account: "111111111111",
        region: "eu-west-1",
        time: "2026-09-10T20:00:00Z",
        detail: { service: "LAMBDA" },
      }),
    );
    expect(event).toMatchObject({ source: "aws.health", detailType: "AWS Health Event" });
    expect(parseEventBridgeMessage(alarmMessage())).toBeUndefined();
  });

  it("detects severity from topic ARNs", () => {
    expect(severityFromTopicArn(TOPIC_CRITICAL)).toBe("critical");
    expect(severityFromTopicArn(TOPIC_LOW)).toBe("low");
    expect(severityFromTopicArn("arn:aws:sns:eu-west-1:111111111111:other")).toBeUndefined();
    expect(severityFromTopicArn(undefined)).toBeUndefined();
  });

  it("recovers service and severity from platform alarm descriptions", () => {
    expect(parseAlarmName("orders-api-errors", "[high] orders: api-errors")).toEqual({
      service: "orders",
      severity: "high",
      shortName: "api-errors",
    });
    expect(parseAlarmName("orders-api-errors", null)).toEqual({ service: "orders" });
    expect(parseAlarmName("Single")).toEqual({});
  });
});

describe("formatMessage", () => {
  it("normalises an alarm with env, service, link and fields", () => {
    const alert = formatMessage({
      message: alarmMessage({ Region: "eu-west-1" }),
      topicArn: TOPIC_CRITICAL,
    });
    expect(alert).toMatchObject({
      kind: "alarm",
      title: "orders-api-errors is ALARM",
      state: "ALARM",
      severity: "high", // description wins over the topic
      env: "dev",
      service: "orders",
      account: "111111111111",
      region: "eu-west-1",
      time: "2026-09-10T20:00:00.000+0000",
      link: alarmConsoleUrl("eu-west-1", "orders-api-errors"),
    });
    expect(alert.link).toBe(
      "https://eu-west-1.console.aws.amazon.com/cloudwatch/home?region=eu-west-1#alarmsV2:alarm/orders-api-errors",
    );
    expect(alert.fields).toEqual([
      { label: "Metric", value: "AWS/Lambda / Errors" },
      { label: "Threshold", value: "SUM GreaterThanOrEqualToThreshold 1" },
    ]);
  });

  it("uses the message attribute, then the topic, then medium for severity", () => {
    const plain = "disk is filling up";
    expect(formatMessage({ message: plain, topicArn: TOPIC_LOW }).severity).toBe("low");
    expect(
      formatMessage({
        message: plain,
        topicArn: TOPIC_LOW,
        attributes: { "platform:severity": "critical" },
      }).severity,
    ).toBe("critical");
    expect(formatMessage({ message: plain }).severity).toBe("medium");
  });

  it("normalises budgets, events and plain text", () => {
    const budget = formatMessage({
      message: BUDGET_MESSAGE,
      subject: "AWS Budgets: platform-dev-monthly has exceeded your alert threshold",
      topicArn: TOPIC_LOW,
    });
    expect(budget).toMatchObject({
      kind: "budget",
      state: "ALARM",
      severity: "low",
      account: "111111111111",
    });
    expect(budget.fields).toEqual([
      { label: "Threshold", value: "greater than $80.00" },
      { label: "Current", value: "$85.12" },
    ]);

    const event = formatMessage({
      message: JSON.stringify({
        source: "aws.health",
        "detail-type": "AWS Health Event",
        detail: { a: 1 },
      }),
    });
    expect(event).toMatchObject({
      kind: "event",
      state: "INFO",
      title: "AWS Health Event (aws.health)",
    });
    expect(event.reason).toContain('"a": 1');

    const text = formatMessage({ message: "hello there", subject: "Ping" });
    expect(text).toMatchObject({
      kind: "text",
      title: "Ping",
      summary: "hello there",
      state: "INFO",
    });
  });
});

describe("payloads", () => {
  const alert = formatMessage({
    message: alarmMessage({ Region: "eu-west-1" }),
    topicArn: TOPIC_CRITICAL,
  });

  it("builds a Slack Block Kit payload with a state emoji and console link", () => {
    const payload = slackPayload(alert, { channelLabel: "#alerts" });
    expect(payload["text"]).toBe(":rotating_light: orders-api-errors is ALARM");
    const blocks = payload["blocks"] as { type: string; [key: string]: unknown }[];
    expect(blocks[0]).toEqual({
      type: "header",
      text: {
        type: "plain_text",
        text: ":rotating_light: orders-api-errors is ALARM",
        emoji: true,
      },
    });
    expect(blocks.map((b) => b.type)).toEqual([
      "header",
      "section",
      "section",
      "section",
      "context",
    ]);
    const fields = (blocks[2]?.["fields"] as { text: string }[]).map((f) => f.text);
    expect(fields).toEqual(
      expect.arrayContaining(["*Severity*\nhigh", "*Environment*\ndev", "*Service*\norders"]),
    );
    const context = (blocks[4]?.["elements"] as { text: string }[]).map((e) => e.text);
    expect(context[0]).toBe("#alerts");
    expect(context[1]).toContain("console.aws.amazon.com");
  });

  it("uses the OK and INSUFFICIENT_DATA emoji", () => {
    const okAlert = formatMessage({ message: alarmMessage({ NewStateValue: "OK" }) });
    expect(slackPayload(okAlert)["text"]).toContain(":white_check_mark:");
    const insufficient = formatMessage({
      message: alarmMessage({ NewStateValue: "INSUFFICIENT_DATA" }),
    });
    expect(slackPayload(insufficient)["text"]).toContain(":grey_question:");
  });

  it("builds a Teams Adaptive Card payload", () => {
    const payload = teamsPayload(alert);
    expect(payload["type"]).toBe("message");
    const attachments = payload["attachments"] as {
      contentType: string;
      content: Record<string, unknown>;
    }[];
    expect(attachments[0]?.contentType).toBe("application/vnd.microsoft.card.adaptive");
    const card = attachments[0]?.content;
    expect(card).toMatchObject({ type: "AdaptiveCard", version: "1.4" });
    const body = card?.["body"] as { type: string; [key: string]: unknown }[];
    expect(body[0]).toMatchObject({
      type: "TextBlock",
      color: "attention",
      text: "orders-api-errors is ALARM",
    });
    expect(body[2]).toMatchObject({ type: "FactSet" });
    const facts = body[2]?.["facts"] as { title: string; value: string }[];
    expect(facts).toEqual(
      expect.arrayContaining([
        { title: "Severity", value: "high" },
        { title: "Environment", value: "dev" },
      ]),
    );
    expect(card?.["actions"]).toEqual([
      { type: "Action.OpenUrl", title: "Open in the AWS console", url: alert.link },
    ]);
  });
});

describe("postWebhook", () => {
  it("retries once on 5xx and 429 then succeeds", async () => {
    const { fetch, calls } = fakeFetch((_call, attempt) => (attempt === 1 ? status(503) : ok()));
    await postWebhook(fetch, SLACK_URL, { text: "hi" }, { sleep: noSleep });
    expect(calls).toHaveLength(2);
  });

  it("throws after the retry fails", async () => {
    const { fetch, calls } = fakeFetch(() => status(429));
    await expect(postWebhook(fetch, SLACK_URL, { text: "hi" }, { sleep: noSleep })).rejects.toThrow(
      /Webhook POST failed: 429/,
    );
    expect(calls).toHaveLength(2);
  });

  it("does not retry 4xx client errors", async () => {
    const { fetch, calls } = fakeFetch(() => status(400));
    await expect(postWebhook(fetch, SLACK_URL, { text: "hi" }, { sleep: noSleep })).rejects.toThrow(
      /400/,
    );
    expect(calls).toHaveLength(1);
  });

  it("retries network errors", async () => {
    const { fetch, calls } = fakeFetch((_call, attempt) =>
      attempt === 1 ? new Error("ECONNRESET") : ok(),
    );
    await postWebhook(fetch, SLACK_URL, { text: "hi" }, { sleep: noSleep });
    expect(calls).toHaveLength(2);
  });
});

describe("handler", () => {
  beforeEach(() => {
    secretsMock.reset();
    secretsMock
      .on(GetSecretValueCommand, { SecretId: SLACK_SECRET })
      .resolves({ SecretString: SLACK_URL });
    secretsMock
      .on(GetSecretValueCommand, { SecretId: TEAMS_SECRET })
      .resolves({ SecretString: JSON.stringify({ url: TEAMS_URL }) });
  });

  it("delivers to every destination whose minimum severity is met", async () => {
    const { fetch, calls } = fakeFetch(() => ok());
    const handler = createHandler({
      fetch,
      secretsManager: new SecretsManagerClient({}),
      destinations,
      sleep: noSleep,
    });

    await handler(snsEvent(record(alarmMessage(), { topicArn: TOPIC_CRITICAL })));

    expect(calls.map((c) => c.url)).toEqual([SLACK_URL, TEAMS_URL]);
    expect(calls[0]?.payload["blocks"]).toBeDefined();
    expect(calls[1]?.payload["attachments"]).toBeDefined();
  });

  it("skips destinations below the minimum severity and caches secrets", async () => {
    const { fetch, calls } = fakeFetch(() => ok());
    const handler = createHandler({
      fetch,
      secretsManager: new SecretsManagerClient({}),
      destinations,
      sleep: noSleep,
    });

    await handler(
      snsEvent(
        record("first", { topicArn: TOPIC_LOW }),
        record("second", { topicArn: TOPIC_LOW, attributes: { "platform:severity": "medium" } }),
      ),
    );

    expect(calls.map((c) => c.url)).toEqual([SLACK_URL, SLACK_URL]);
    expect(secretsMock.commandCalls(GetSecretValueCommand)).toHaveLength(1);
  });

  it("reads destinations from the environment", async () => {
    process.env["DESTINATIONS"] = JSON.stringify([destinations[0]]);
    try {
      const { fetch, calls } = fakeFetch(() => ok());
      const handler = createHandler({
        fetch,
        secretsManager: new SecretsManagerClient({}),
        sleep: noSleep,
      });
      await handler(snsEvent(record("hello", { topicArn: TOPIC_LOW })));
      expect(calls).toHaveLength(1);
    } finally {
      delete process.env["DESTINATIONS"];
    }
    expect(() => parseDestinations(undefined)).toThrow(/DESTINATIONS/);
    expect(() => parseDestinations("{}")).toThrow(/JSON array/);
  });

  it("throws when a delivery keeps failing so SNS retries and the DLQ apply", async () => {
    const { fetch, calls } = fakeFetch((call) => (call.url === TEAMS_URL ? status(500) : ok()));
    const handler = createHandler({
      fetch,
      secretsManager: new SecretsManagerClient({}),
      destinations,
      sleep: noSleep,
    });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(handler(snsEvent(record(alarmMessage())))).rejects.toThrow(/1 delivery failure/);
    // Slack succeeded once, Teams tried twice
    expect(calls.filter((c) => c.url === SLACK_URL)).toHaveLength(1);
    expect(calls.filter((c) => c.url === TEAMS_URL)).toHaveLength(2);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("validates webhook secrets", () => {
    expect(parseWebhookUrl(` ${SLACK_URL} `)).toBe(SLACK_URL);
    expect(parseWebhookUrl(JSON.stringify({ webhookUrl: TEAMS_URL }))).toBe(TEAMS_URL);
    expect(() => parseWebhookUrl("http://insecure.example.com/hook")).toThrow(/https/);
    expect(() => parseWebhookUrl(JSON.stringify({ nope: true }))).toThrow(/url/);
  });
});
