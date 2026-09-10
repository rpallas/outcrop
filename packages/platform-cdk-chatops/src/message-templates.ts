import { ALERT_SEVERITIES, type AlertSeverity, isAlertSeverity } from "@rpallas/platform-cdk";

/** State of the thing that triggered a notification. */
export type AlertState = "ALARM" | "OK" | "INSUFFICIENT_DATA" | "INFO";

/** Normalised notification, independent of the chat provider. */
export interface AlertMessage {
  readonly kind: "alarm" | "budget" | "event" | "text";
  readonly title: string;
  readonly state: AlertState;
  readonly severity: AlertSeverity;
  readonly summary: string;
  readonly reason?: string;
  readonly time?: string;
  readonly env?: string;
  readonly service?: string;
  readonly account?: string;
  readonly region?: string;
  readonly link?: string;
  /** Extra label/value pairs rendered as fields. */
  readonly fields: readonly AlertField[];
}

export interface AlertField {
  readonly label: string;
  readonly value: string;
}

/** Subset of the CloudWatch alarm state change notification that is rendered. */
export interface CloudWatchAlarmNotification {
  readonly AlarmName: string;
  readonly AlarmDescription?: string | null;
  readonly AWSAccountId?: string;
  readonly Region?: string;
  readonly AlarmArn?: string;
  readonly NewStateValue: string;
  readonly NewStateReason?: string;
  readonly OldStateValue?: string;
  readonly StateChangeTime?: string;
  readonly Trigger?: {
    readonly MetricName?: string;
    readonly Namespace?: string;
    readonly Statistic?: string;
    readonly Threshold?: number;
    readonly ComparisonOperator?: string;
    readonly Dimensions?: readonly { readonly name: string; readonly value: string }[];
  };
}

/** Parsed AWS Budgets notification (plain text e-mail style message). */
export interface BudgetNotification {
  readonly budgetName?: string;
  readonly accountId?: string;
  readonly thresholdText?: string;
  readonly actualText?: string;
  readonly body: string;
}

/** Parsed EventBridge event (as delivered to SNS by a rule). */
export interface EventBridgeNotification {
  readonly source: string;
  readonly detailType: string;
  readonly account?: string;
  readonly region?: string;
  readonly time?: string;
  readonly detail: unknown;
}

/** Inputs used to normalise one SNS record. */
export interface FormatMessageInput {
  readonly message: string;
  readonly subject?: string;
  readonly topicArn?: string;
  /** SNS message attributes flattened to `name -> value`. */
  readonly attributes?: Readonly<Record<string, string>>;
}

export const SEVERITY_ATTRIBUTE = "platform:severity";
export const DEFAULT_SEVERITY: AlertSeverity = "medium";

const SEVERITY_RANK: Record<AlertSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** Numeric rank of a severity (`low` = 0 ... `critical` = 3). */
export const severityRank = (severity: AlertSeverity): number => SEVERITY_RANK[severity];

/** True when `severity` is at least `minimum`. */
export const meetsMinimumSeverity = (severity: AlertSeverity, minimum: AlertSeverity): boolean =>
  severityRank(severity) >= severityRank(minimum);

/** Regions of AWS console hostnames differ for partitions; the commercial one is used. */
const consoleHost = (region: string): string => `https://${region}.console.aws.amazon.com`;

/** Deep link to a CloudWatch alarm in the console. */
export const alarmConsoleUrl = (region: string, alarmName: string): string =>
  `${consoleHost(region)}/cloudwatch/home?region=${encodeURIComponent(region)}#alarmsV2:alarm/${encodeURIComponent(alarmName)}`;

const SEVERITY_ALTERNATION = ALERT_SEVERITIES.join("|");
const TOPIC_SEVERITY_RE = new RegExp(`-alerts-(${SEVERITY_ALTERNATION})$`);
const TOPIC_ENV_RE = new RegExp(`^platform-(.+)-alerts-(${SEVERITY_ALTERNATION})$`);

/** Severity encoded in the platform alert topic name (`...-alerts-critical`). */
export const severityFromTopicArn = (topicArn: string | undefined): AlertSeverity | undefined => {
  if (!topicArn) return undefined;
  const name = topicArn.split(":").pop() ?? topicArn;
  const match = TOPIC_SEVERITY_RE.exec(name);
  const value = match?.[1];
  return value !== undefined && isAlertSeverity(value) ? value : undefined;
};

/** Environment encoded in the account baseline topic name (`platform-<env>-alerts-<severity>`). */
export const envFromTopicArn = (topicArn: string | undefined): string | undefined => {
  if (!topicArn) return undefined;
  const name = topicArn.split(":").pop() ?? topicArn;
  return TOPIC_ENV_RE.exec(name)?.[1];
};

/** Severity from the `platform:severity` attribute, then the topic name, then `medium`. */
export const resolveSeverity = (input: FormatMessageInput): AlertSeverity => {
  const attribute = input.attributes?.[SEVERITY_ATTRIBUTE];
  if (attribute !== undefined && isAlertSeverity(attribute)) return attribute;
  return severityFromTopicArn(input.topicArn) ?? DEFAULT_SEVERITY;
};

const tryParseJson = (value: string): unknown => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Parse a CloudWatch alarm state change notification; undefined when the message is something else. */
export const parseAlarmMessage = (message: string): CloudWatchAlarmNotification | undefined => {
  const parsed = tryParseJson(message);
  if (!isRecord(parsed)) return undefined;
  if (typeof parsed["AlarmName"] !== "string" || typeof parsed["NewStateValue"] !== "string") {
    return undefined;
  }
  return parsed as unknown as CloudWatchAlarmNotification;
};

const BUDGET_MARKER_RE = /AWS Budget/i;

/** Parse an AWS Budgets notification; undefined when the message is not one. */
export const parseBudgetMessage = (
  message: string,
  subject?: string,
): BudgetNotification | undefined => {
  if (!BUDGET_MARKER_RE.test(message) && !(subject && BUDGET_MARKER_RE.test(subject))) {
    return undefined;
  }
  const budgetName =
    /associated with your (.+?) budget/i.exec(message)?.[1] ??
    /AWS Budgets?: (.+?) has/i.exec(subject ?? "")?.[1];
  const accountId = /AWS Account (\d{12})/.exec(message)?.[1];
  const amount = String.raw`(\$?\d[\d,]*(?:\.\d+)?%?)`;
  const thresholdText = new RegExp(`is (greater than|less than|equal to) ${amount}`, "i").exec(
    message,
  );
  const actualText = new RegExp(`(ACTUAL|FORECASTED) (?:Cost|Usage)[^.]*? is ${amount}`, "i").exec(
    message,
  );
  return {
    ...(budgetName !== undefined ? { budgetName: budgetName.trim() } : {}),
    ...(accountId !== undefined ? { accountId } : {}),
    ...(thresholdText ? { thresholdText: `${thresholdText[1]} ${thresholdText[2]}` } : {}),
    ...(actualText?.[2] !== undefined ? { actualText: actualText[2] } : {}),
    body: message.trim(),
  };
};

/** Parse an EventBridge event; undefined when the message is not one. */
export const parseEventBridgeMessage = (message: string): EventBridgeNotification | undefined => {
  const parsed = tryParseJson(message);
  if (!isRecord(parsed)) return undefined;
  const detailType = parsed["detail-type"];
  const source = parsed["source"];
  if (typeof detailType !== "string" || typeof source !== "string") return undefined;
  return {
    source,
    detailType,
    ...(typeof parsed["account"] === "string" ? { account: parsed["account"] } : {}),
    ...(typeof parsed["region"] === "string" ? { region: parsed["region"] } : {}),
    ...(typeof parsed["time"] === "string" ? { time: parsed["time"] } : {}),
    detail: parsed["detail"],
  };
};

const DESCRIPTION_RE = new RegExp(`^\\[(${SEVERITY_ALTERNATION})\\]\\s+([^:]+):\\s*(.*)$`, "s");

/**
 * Platform alarms are described as `[severity] service: name`; recover the
 * service (and severity) from that. Falls back to the alarm name segments.
 */
export const parseAlarmName = (
  alarmName: string,
  description?: string | null,
): { service?: string; severity?: AlertSeverity; shortName?: string } => {
  if (description) {
    const match = DESCRIPTION_RE.exec(description.trim());
    const severity = match?.[1];
    const service = match?.[2]?.trim();
    if (service && severity && isAlertSeverity(severity)) {
      return { service, severity, ...(match?.[3] ? { shortName: match[3].trim() } : {}) };
    }
  }
  const segments = alarmName.split("-").filter((s) => s.length > 0);
  const [first] = segments;
  return first !== undefined && segments.length > 1 ? { service: first } : {};
};

const alarmState = (value: string): AlertState => {
  switch (value) {
    case "ALARM":
    case "OK":
    case "INSUFFICIENT_DATA":
      return value;
    default:
      return "INFO";
  }
};

/** `AlertMessage` with `undefined` allowed everywhere, dropped by `compact`. */
type LooseAlertMessage = { [K in keyof AlertMessage]: AlertMessage[K] | undefined };

const compact = (value: LooseAlertMessage): AlertMessage =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as unknown as AlertMessage;

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/** Normalise an SNS message (alarm, budget, EventBridge event or text) into an `AlertMessage`. */
export const formatMessage = (input: FormatMessageInput): AlertMessage => {
  const topicSeverity = resolveSeverity(input);
  const env = envFromTopicArn(input.topicArn);

  const alarm = parseAlarmMessage(input.message);
  if (alarm) {
    const parsed = parseAlarmName(alarm.AlarmName, alarm.AlarmDescription);
    const state = alarmState(alarm.NewStateValue);
    const region = alarm.Region ?? undefined;
    const trigger = alarm.Trigger;
    const fields: AlertField[] = [];
    if (trigger?.Namespace && trigger.MetricName) {
      fields.push({ label: "Metric", value: `${trigger.Namespace} / ${trigger.MetricName}` });
    }
    if (trigger?.Threshold !== undefined) {
      fields.push({
        label: "Threshold",
        value:
          `${trigger.Statistic ?? ""} ${trigger.ComparisonOperator ?? ""} ${trigger.Threshold}`.trim(),
      });
    }
    return compact({
      kind: "alarm",
      title: `${alarm.AlarmName} is ${alarm.NewStateValue}`,
      state,
      severity: parsed.severity ?? topicSeverity,
      summary: alarm.AlarmDescription ?? alarm.AlarmName,
      reason: alarm.NewStateReason ?? undefined,
      time: alarm.StateChangeTime ?? undefined,
      env,
      service: parsed.service,
      account: alarm.AWSAccountId,
      region,
      link: region ? alarmConsoleUrl(region, alarm.AlarmName) : undefined,
      fields,
    });
  }

  const budget = parseBudgetMessage(input.message, input.subject);
  if (budget) {
    const fields: AlertField[] = [];
    if (budget.thresholdText) fields.push({ label: "Threshold", value: budget.thresholdText });
    if (budget.actualText) fields.push({ label: "Current", value: budget.actualText });
    return compact({
      kind: "budget",
      title: input.subject ?? `AWS Budget ${budget.budgetName ?? "notification"}`,
      state: "ALARM",
      severity: topicSeverity,
      summary: budget.budgetName
        ? `Budget ${budget.budgetName} breached a threshold`
        : "AWS Budgets notification",
      reason: truncate(budget.body, 1500),
      env,
      account: budget.accountId,
      fields,
    });
  }

  const event = parseEventBridgeMessage(input.message);
  if (event) {
    return compact({
      kind: "event",
      title: input.subject ?? `${event.detailType} (${event.source})`,
      state: "INFO",
      severity: topicSeverity,
      summary: `${event.source}: ${event.detailType}`,
      reason: truncate(
        typeof event.detail === "string" ? event.detail : JSON.stringify(event.detail, null, 2),
        1500,
      ),
      time: event.time,
      env,
      account: event.account,
      region: event.region,
      fields: [],
    });
  }

  return compact({
    kind: "text",
    title: input.subject ?? "Platform notification",
    state: "INFO",
    severity: topicSeverity,
    summary: truncate(input.message.trim(), 2500),
    env,
    fields: [],
  });
};

const STATE_EMOJI: Record<AlertState, string> = {
  ALARM: ":rotating_light:",
  OK: ":white_check_mark:",
  INSUFFICIENT_DATA: ":grey_question:",
  INFO: ":information_source:",
};

const STATE_COLOUR: Record<AlertState, "attention" | "good" | "warning" | "accent"> = {
  ALARM: "attention",
  OK: "good",
  INSUFFICIENT_DATA: "warning",
  INFO: "accent",
};

export interface PayloadOptions {
  /** Free-text label shown in the message (for example the channel or team). */
  readonly channelLabel?: string;
}

const contextFields = (alert: AlertMessage): AlertField[] => {
  const fields: AlertField[] = [{ label: "Severity", value: alert.severity }];
  if (alert.env) fields.push({ label: "Environment", value: alert.env });
  if (alert.service) fields.push({ label: "Service", value: alert.service });
  if (alert.account) fields.push({ label: "Account", value: alert.account });
  if (alert.region) fields.push({ label: "Region", value: alert.region });
  if (alert.time) fields.push({ label: "Time", value: alert.time });
  return [...fields, ...alert.fields];
};

/** Slack Block Kit payload for an incoming webhook. */
export const slackPayload = (
  alert: AlertMessage,
  options: PayloadOptions = {},
): Record<string, unknown> => {
  const headerText = truncate(`${STATE_EMOJI[alert.state]} ${alert.title}`, 150);
  const blocks: Record<string, unknown>[] = [
    { type: "header", text: { type: "plain_text", text: headerText, emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: truncate(alert.summary, 2900) } },
  ];
  const fields = contextFields(alert);
  for (let i = 0; i < fields.length; i += 10) {
    blocks.push({
      type: "section",
      fields: fields.slice(i, i + 10).map((f) => ({
        type: "mrkdwn",
        text: truncate(`*${f.label}*\n${f.value}`, 2000),
      })),
    });
  }
  if (alert.reason) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: truncate(`*Reason*\n${alert.reason}`, 2900) },
    });
  }
  const contextElements: string[] = [];
  if (options.channelLabel) contextElements.push(options.channelLabel);
  if (alert.link) contextElements.push(`<${alert.link}|Open in the AWS console>`);
  if (contextElements.length > 0) {
    blocks.push({
      type: "context",
      elements: contextElements.map((text) => ({ type: "mrkdwn", text })),
    });
  }
  return { text: headerText, blocks };
};

/** Microsoft Teams incoming webhook payload with an Adaptive Card (schema 1.4). */
export const teamsPayload = (
  alert: AlertMessage,
  options: PayloadOptions = {},
): Record<string, unknown> => {
  const body: Record<string, unknown>[] = [
    {
      type: "TextBlock",
      size: "Large",
      weight: "Bolder",
      color: STATE_COLOUR[alert.state],
      text: truncate(alert.title, 250),
      wrap: true,
    },
    { type: "TextBlock", text: truncate(alert.summary, 2000), wrap: true },
    {
      type: "FactSet",
      facts: contextFields(alert).map((f) => ({ title: f.label, value: f.value })),
    },
  ];
  if (alert.reason) {
    body.push({
      type: "TextBlock",
      text: truncate(alert.reason, 2000),
      wrap: true,
      isSubtle: true,
    });
  }
  if (options.channelLabel) {
    body.push({ type: "TextBlock", text: options.channelLabel, size: "Small", isSubtle: true });
  }
  const card: Record<string, unknown> = {
    type: "AdaptiveCard",
    version: "1.4",
    msteams: { width: "Full" },
    body,
    ...(alert.link
      ? { actions: [{ type: "Action.OpenUrl", title: "Open in the AWS console", url: alert.link }] }
      : {}),
  };
  return {
    type: "message",
    summary: truncate(alert.title, 250),
    attachments: [
      { contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content: card },
    ],
  };
};
