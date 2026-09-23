import {
  EventBridgeClient,
  PutEventsCommand,
  type PutEventsRequestEntry,
  type PutEventsResultEntry,
} from "@aws-sdk/client-eventbridge";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { EventBridgeEvent, SQSRecord } from "aws-lambda";
import { randomUUID } from "node:crypto";

/** Location of an event body that was too large for EventBridge and was stored in S3. */
export interface OffloadedPointer {
  bucket: string;
  key: string;
}

/**
 * Envelope stored in the EventBridge `detail` field.
 * `eventBody` is `undefined` while the body lives in S3 (see {@link OffloadedPointer}).
 */
export interface PlatformEvent<T = unknown> {
  eventName: string;
  eventBody: T;
  offloaded?: OffloadedPointer;
}

/** Default maximum `detail` size before the body is offloaded to S3 (EventBridge allows 256 KiB per entry). */
export const DEFAULT_OFFLOAD_THRESHOLD_BYTES = 200_000;

/** Maximum number of entries in a single `PutEvents` call. */
export const PUT_EVENTS_BATCH_SIZE = 10;

export interface OffloadOptions {
  /** Bucket that receives large event bodies. */
  bucket: string;
  /** Detail size (in bytes) above which the body is offloaded (default 200 000). */
  thresholdBytes?: number;
  /** Custom S3 client, mainly for tests. */
  client?: S3Client;
  /** Key prefix inside the bucket (default `events`). */
  keyPrefix?: string;
}

export interface PublishEventOptions {
  /** Event bus name; defaults to `EVENT_BUS_NAME`. */
  busName?: string;
  /** Event source; defaults to `PLATFORM_SERVICE`. */
  source?: string;
  /** Custom EventBridge client, mainly for tests. */
  client?: EventBridgeClient;
  /** ARNs the event relates to. */
  resources?: string[];
  /** Event time; defaults to now. */
  time?: Date;
  /** Store large bodies in S3 and publish a pointer instead. */
  offload?: OffloadOptions;
}

export interface PublishEventResult {
  eventId?: string;
}

export interface EventToPublish<T = unknown> {
  eventName: string;
  eventBody: T;
}

let defaultEventBridgeClient: EventBridgeClient | undefined;
let defaultS3Client: S3Client | undefined;

const eventBridgeClient = (client?: EventBridgeClient): EventBridgeClient => {
  if (client) return client;
  defaultEventBridgeClient ??= new EventBridgeClient({});
  return defaultEventBridgeClient;
};

const s3Client = (client?: S3Client): S3Client => {
  if (client) return client;
  defaultS3Client ??= new S3Client({});
  return defaultS3Client;
};

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : value;

const resolveBusName = (options: PublishEventOptions): string => {
  const busName = options.busName ?? nonEmpty(process.env["EVENT_BUS_NAME"]);
  if (busName === undefined) {
    throw new Error("No event bus configured: pass `busName` or set EVENT_BUS_NAME");
  }
  return busName;
};

const resolveSource = (options: PublishEventOptions): string => {
  const source = options.source ?? nonEmpty(process.env["PLATFORM_SERVICE"]);
  if (source === undefined) {
    throw new Error("No event source configured: pass `source` or set PLATFORM_SERVICE");
  }
  return source;
};

const buildEntry = async <T>(
  event: EventToPublish<T>,
  options: PublishEventOptions,
  busName: string,
  source: string,
): Promise<PutEventsRequestEntry> => {
  let detail = JSON.stringify({ eventName: event.eventName, eventBody: event.eventBody });

  const offload = options.offload;
  if (
    offload &&
    Buffer.byteLength(detail, "utf8") > (offload.thresholdBytes ?? DEFAULT_OFFLOAD_THRESHOLD_BYTES)
  ) {
    const key = `${(offload.keyPrefix ?? "events").replace(/\/+$/, "")}/${event.eventName}/${randomUUID()}.json`;
    await s3Client(offload.client).send(
      new PutObjectCommand({
        Bucket: offload.bucket,
        Key: key,
        Body: JSON.stringify(event.eventBody),
        ContentType: "application/json",
      }),
    );
    const pointer: OffloadedPointer = { bucket: offload.bucket, key };
    const envelope: PlatformEvent<undefined> = {
      eventName: event.eventName,
      eventBody: undefined,
      offloaded: pointer,
    };
    detail = JSON.stringify(envelope);
  }

  const entry: PutEventsRequestEntry = {
    EventBusName: busName,
    Source: source,
    DetailType: event.eventName,
    Detail: detail,
  };
  if (options.resources) entry.Resources = options.resources;
  if (options.time) entry.Time = options.time;
  return entry;
};

const putEntries = async (
  entries: PutEventsRequestEntry[],
  client: EventBridgeClient,
): Promise<PublishEventResult[]> => {
  const response = await client.send(new PutEventsCommand({ Entries: entries }));
  const results: PutEventsResultEntry[] = response.Entries ?? [];
  if ((response.FailedEntryCount ?? 0) > 0) {
    const failures = results
      .filter((entry) => entry.ErrorCode !== undefined)
      .map((entry) => `${entry.ErrorCode ?? "Unknown"}: ${entry.ErrorMessage ?? ""}`.trim());
    throw new Error(
      `Failed to publish ${response.FailedEntryCount} of ${entries.length} event(s): ${failures.join("; ")}`,
    );
  }
  return entries.map((_, index) => {
    const eventId = results[index]?.EventId;
    return eventId === undefined ? {} : { eventId };
  });
};

/**
 * Publishes a single platform event to EventBridge.
 *
 * The `detail` is a {@link PlatformEvent} envelope, `detail-type` is the event
 * name and `source` is the publishing service.
 */
export async function publishEvent(
  eventName: string,
  eventBody: unknown,
  options: PublishEventOptions = {},
): Promise<PublishEventResult> {
  const busName = resolveBusName(options);
  const source = resolveSource(options);
  const entry = await buildEntry({ eventName, eventBody }, options, busName, source);
  const [result] = await putEntries([entry], eventBridgeClient(options.client));
  return result ?? {};
}

/**
 * Publishes several events, in batches of 10 (the `PutEvents` limit).
 * Results are returned in the same order as `events`.
 */
export async function publishEvents<T = unknown>(
  events: EventToPublish<T>[],
  options: PublishEventOptions = {},
): Promise<PublishEventResult[]> {
  if (events.length === 0) return [];
  const busName = resolveBusName(options);
  const source = resolveSource(options);
  const client = eventBridgeClient(options.client);
  const entries = await Promise.all(
    events.map((event) => buildEntry(event, options, busName, source)),
  );

  const results: PublishEventResult[] = [];
  for (let start = 0; start < entries.length; start += PUT_EVENTS_BATCH_SIZE) {
    const batch = entries.slice(start, start + PUT_EVENTS_BATCH_SIZE);
    results.push(...(await putEntries(batch, client)));
  }
  return results;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isOffloadedPointer = (value: unknown): value is OffloadedPointer =>
  isRecord(value) && typeof value["bucket"] === "string" && typeof value["key"] === "string";

interface RawEnvelope {
  eventName: string;
  eventBody: unknown;
  hasBody: boolean;
  offloaded?: OffloadedPointer;
}

const readEnvelope = (detail: unknown): RawEnvelope => {
  if (!isRecord(detail)) {
    throw new Error("Event detail is not a platform envelope: expected an object");
  }
  const eventName = detail["eventName"];
  if (typeof eventName !== "string" || eventName === "") {
    throw new Error("Event detail is not a platform envelope: missing `eventName`");
  }
  const offloaded = detail["offloaded"];
  const raw: RawEnvelope = {
    eventName,
    eventBody: detail["eventBody"],
    hasBody: Object.hasOwn(detail, "eventBody"),
  };
  if (offloaded !== undefined) {
    if (!isOffloadedPointer(offloaded)) {
      throw new Error("Event detail is not a platform envelope: invalid `offloaded` pointer");
    }
    raw.offloaded = offloaded;
  }
  if (!raw.hasBody && raw.offloaded === undefined) {
    throw new Error("Event detail is not a platform envelope: missing `eventBody`");
  }
  return raw;
};

const applyParse = <T>(body: unknown, parse: ((body: unknown) => T) | undefined): T =>
  parse ? parse(body) : (body as T);

/**
 * Extracts and validates the {@link PlatformEvent} envelope from an EventBridge event.
 *
 * Throws when the detail is not an envelope. Offloaded envelopes (body stored in
 * S3) cannot be parsed synchronously; use {@link resolveEnvelope} for those.
 */
export function parseEnvelope<T = unknown>(
  event: EventBridgeEvent<string, unknown>,
  parse?: (body: unknown) => T,
): PlatformEvent<T> {
  const raw = readEnvelope(event.detail);
  if (raw.offloaded !== undefined && !raw.hasBody) {
    throw new Error(
      `Event "${raw.eventName}" body is offloaded to s3://${raw.offloaded.bucket}/${raw.offloaded.key}; use resolveEnvelope()`,
    );
  }
  const envelope: PlatformEvent<T> = {
    eventName: raw.eventName,
    eventBody: applyParse(raw.eventBody, parse),
  };
  if (raw.offloaded !== undefined) envelope.offloaded = raw.offloaded;
  return envelope;
}

/**
 * Parses the platform envelope from an SQS record that was delivered by an
 * EventBridge rule (the SQS body is the EventBridge event JSON).
 */
export function parseSqsEnvelope<T = unknown>(
  record: SQSRecord,
  parse?: (body: unknown) => T,
): PlatformEvent<T> {
  return parseEnvelope(eventFromSqsRecord(record), parse);
}

/** Decodes the EventBridge event carried in an SQS record body. */
export function eventFromSqsRecord(record: SQSRecord): EventBridgeEvent<string, unknown> {
  let body: unknown;
  try {
    body = JSON.parse(record.body);
  } catch (error) {
    throw new Error(
      `SQS record ${record.messageId} body is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(body) || !Object.hasOwn(body, "detail")) {
    throw new Error(`SQS record ${record.messageId} body is not an EventBridge event`);
  }
  return body as unknown as EventBridgeEvent<string, unknown>;
}

export interface ResolveEnvelopeOptions<T> {
  /** Custom S3 client used to download offloaded bodies, mainly for tests. */
  s3Client?: S3Client;
  /** Validates / narrows the body, e.g. `schema.parse` from zod. */
  parse?: (body: unknown) => T;
}

/**
 * Like {@link parseEnvelope} but downloads the body from S3 when it was offloaded.
 */
export async function resolveEnvelope<T = unknown>(
  event: EventBridgeEvent<string, unknown>,
  options: ResolveEnvelopeOptions<T> = {},
): Promise<PlatformEvent<T>> {
  const raw = readEnvelope(event.detail);
  let body: unknown = raw.eventBody;
  if (raw.offloaded !== undefined && !raw.hasBody) {
    const response = await s3Client(options.s3Client).send(
      new GetObjectCommand({ Bucket: raw.offloaded.bucket, Key: raw.offloaded.key }),
    );
    if (!response.Body) {
      throw new Error(
        `Offloaded event body s3://${raw.offloaded.bucket}/${raw.offloaded.key} is empty`,
      );
    }
    body = JSON.parse(await response.Body.transformToString("utf8"));
  }
  const envelope: PlatformEvent<T> = {
    eventName: raw.eventName,
    eventBody: applyParse(body, options.parse),
  };
  if (raw.offloaded !== undefined) envelope.offloaded = raw.offloaded;
  return envelope;
}

/** Like {@link parseSqsEnvelope} but downloads offloaded bodies from S3. */
export function resolveSqsEnvelope<T = unknown>(
  record: SQSRecord,
  options: ResolveEnvelopeOptions<T> = {},
): Promise<PlatformEvent<T>> {
  return resolveEnvelope(eventFromSqsRecord(record), options);
}
