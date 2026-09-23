import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { AlertSeverity } from "@rpallas/outcrop";
import type { SNSEvent, SNSEventRecord } from "aws-lambda";
import {
  type AlertMessage,
  formatMessage,
  meetsMinimumSeverity,
  slackPayload,
  teamsPayload,
} from "../message-templates";

export {
  formatMessage,
  parseAlarmMessage,
  parseBudgetMessage,
  parseEventBridgeMessage,
  severityFromTopicArn,
  slackPayload,
  teamsPayload,
} from "../message-templates";

/** Supported chat providers. */
export type ChatOpsKind = "slack" | "teams";

/** One destination as serialised into the `DESTINATIONS` environment variable. */
export interface DestinationConfig {
  readonly kind: ChatOpsKind;
  /** Secrets Manager ARN of the secret holding the webhook URL. */
  readonly webhookSecretArn: string;
  readonly minimumSeverity: AlertSeverity;
  readonly channelLabel?: string;
}

/** Name of the environment variable carrying the JSON `DestinationConfig[]`. */
export const DESTINATIONS_ENV = "DESTINATIONS";

export type FetchLike = typeof fetch;

export interface NotifyDependencies {
  readonly fetch?: FetchLike;
  readonly secretsManager?: SecretsManagerClient;
  /** Destinations; defaults to `process.env.DESTINATIONS`. */
  readonly destinations?: readonly DestinationConfig[];
  /** Delay before the single retry, in ms (default 500). */
  readonly retryDelayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Parse the `DESTINATIONS` environment variable. */
export const parseDestinations = (value: string | undefined): DestinationConfig[] => {
  if (!value) throw new Error(`${DESTINATIONS_ENV} environment variable is not set`);
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error(`${DESTINATIONS_ENV} must be a JSON array`);
  return parsed as DestinationConfig[];
};

/** Flatten SNS message attributes to `name -> value`. */
export const flattenAttributes = (record: SNSEventRecord): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [name, attribute] of Object.entries(record.Sns.MessageAttributes ?? {})) {
    result[name] = attribute.Value;
  }
  return result;
};

/** Normalise one SNS record. */
export const alertFromRecord = (record: SNSEventRecord): AlertMessage =>
  formatMessage({
    message: record.Sns.Message,
    ...(record.Sns.Subject ? { subject: record.Sns.Subject } : {}),
    topicArn: record.Sns.TopicArn,
    attributes: flattenAttributes(record),
  });

/** The webhook secret is a plain URL or JSON `{ url }` / `{ webhookUrl }`. */
export const parseWebhookUrl = (secretString: string): string => {
  const trimmed = secretString.trim();
  if (trimmed.startsWith("{")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const candidate = record["url"] ?? record["webhookUrl"] ?? record["webhook_url"];
      if (typeof candidate === "string" && candidate.length > 0) return candidate;
    }
    throw new Error("Webhook secret is JSON but has no `url` property");
  }
  if (!trimmed.startsWith("https://")) throw new Error("Webhook secret is not an https URL");
  return trimmed;
};

export const payloadFor = (
  destination: DestinationConfig,
  alert: AlertMessage,
): Record<string, unknown> => {
  const options = destination.channelLabel ? { channelLabel: destination.channelLabel } : {};
  return destination.kind === "teams" ? teamsPayload(alert, options) : slackPayload(alert, options);
};

const retryable = (status: number): boolean => status === 429 || status >= 500;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST a payload to a webhook, retrying once on 429/5xx. Throws on persistent
 * failure so the SNS retry policy and the dead letter queue apply.
 */
export const postWebhook = async (
  fetchImpl: FetchLike,
  url: string,
  payload: Record<string, unknown>,
  options: { retryDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> => {
  const body = JSON.stringify(payload);
  let lastError: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await (options.sleep ?? defaultSleep)(options.retryDelayMs ?? 500);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      continue;
    }
    if (response.ok) return;
    const text = await response.text().catch(() => "");
    lastError = `${response.status} ${text.slice(0, 300)}`;
    if (!retryable(response.status)) break;
  }
  throw new Error(`Webhook POST failed: ${lastError ?? "unknown error"}`);
};

/** Build the SNS handler with injectable `fetch`, Secrets Manager client and destinations. */
export const createHandler = (
  deps: NotifyDependencies = {},
): ((event: SNSEvent) => Promise<void>) => {
  const secretsManager = deps.secretsManager ?? new SecretsManagerClient({});
  const fetchImpl = deps.fetch ?? fetch;
  const urlCache = new Map<string, Promise<string>>();

  const webhookUrl = (secretArn: string): Promise<string> => {
    let cached = urlCache.get(secretArn);
    if (!cached) {
      cached = secretsManager
        .send(new GetSecretValueCommand({ SecretId: secretArn }))
        .then((result) => {
          if (!result.SecretString) throw new Error(`Secret ${secretArn} has no string value`);
          return parseWebhookUrl(result.SecretString);
        });
      cached.catch(() => urlCache.delete(secretArn));
      urlCache.set(secretArn, cached);
    }
    return cached;
  };

  return async (event: SNSEvent): Promise<void> => {
    const destinations = deps.destinations ?? parseDestinations(process.env[DESTINATIONS_ENV]);
    const failures: string[] = [];
    for (const record of event.Records) {
      const alert = alertFromRecord(record);
      const targets = destinations.filter((d) =>
        meetsMinimumSeverity(alert.severity, d.minimumSeverity),
      );
      const results = await Promise.allSettled(
        targets.map(async (destination) => {
          const url = await webhookUrl(destination.webhookSecretArn);
          await postWebhook(fetchImpl, url, payloadFor(destination, alert), {
            ...(deps.retryDelayMs !== undefined ? { retryDelayMs: deps.retryDelayMs } : {}),
            ...(deps.sleep ? { sleep: deps.sleep } : {}),
          });
        }),
      );
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          const destination = targets[index];
          const reason =
            result.reason instanceof Error ? result.reason.message : String(result.reason);
          const label = destination
            ? `${destination.kind}${destination.channelLabel ? ` (${destination.channelLabel})` : ""}`
            : "unknown";
          console.error(`chatops: delivery to ${label} failed for ${alert.title}: ${reason}`);
          failures.push(`${label}: ${reason}`);
        }
      });
    }
    if (failures.length > 0) {
      throw new Error(`chatops: ${failures.length} delivery failure(s): ${failures.join("; ")}`);
    }
  };
};

/** Lambda entry point. */
export const handler = createHandler();
