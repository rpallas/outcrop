import type { Logger } from "@aws-lambda-powertools/logger";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
  EventBridgeEvent,
  SQSBatchItemFailure,
  SQSBatchResponse,
  SQSEvent,
  SQSRecord,
} from "aws-lambda";
import type { S3Client } from "@aws-sdk/client-s3";
import { resolveEnvelope, type PlatformEvent } from "./events";
import { findHeader, isHttpError, json } from "./http";
import { getLogger } from "./logger";

export type LambdaHandler<TEvent, TResult> = (event: TEvent, context: Context) => Promise<TResult>;

export const CORRELATION_ID_HEADER = "x-correlation-id";

export interface WithHandlerOptions<TEvent, TResult> {
  /** Logger to use; defaults to {@link getLogger}. */
  logger?: Logger;
  /** Log the incoming event at `info` level (default: honour `POWERTOOLS_LOGGER_LOG_EVENT`). */
  logEvent?: boolean;
  /** Called instead of rethrowing when the handler fails. */
  onError?: (error: unknown, event: TEvent, context: Context) => Promise<TResult> | TResult;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringHeaders = (value: unknown): Record<string, string | undefined> | undefined => {
  if (!isRecord(value)) return undefined;
  const headers: Record<string, string | undefined> = {};
  for (const [key, header] of Object.entries(value)) {
    if (typeof header === "string") headers[key] = header;
  }
  return headers;
};

/**
 * Picks the correlation id for an invocation: the `x-correlation-id` header,
 * then the HTTP API request id, then the EventBridge event id, then the Lambda
 * request id.
 */
export function resolveCorrelationId(event: unknown, context: Context): string {
  if (isRecord(event)) {
    const fromHeader = findHeader(stringHeaders(event["headers"]), CORRELATION_ID_HEADER);
    if (fromHeader !== undefined && fromHeader !== "") return fromHeader;

    const requestContext = event["requestContext"];
    if (isRecord(requestContext)) {
      const requestId = requestContext["requestId"];
      if (typeof requestId === "string" && requestId !== "") return requestId;
    }

    const id = event["id"];
    if (typeof id === "string" && id !== "") return id;
  }
  return context.awsRequestId;
}

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(typeof error === "string" ? error : String(error));

/**
 * Wraps a Lambda handler with logging boilerplate: Lambda context and cold start
 * tracking, event logging, a per-invocation `correlationId` key, error logging
 * and key cleanup.
 */
export function withHandler<TEvent, TResult>(
  handler: LambdaHandler<TEvent, TResult>,
  options: WithHandlerOptions<TEvent, TResult> = {},
): LambdaHandler<TEvent, TResult> {
  return async (event, context) => {
    const logger = options.logger ?? getLogger();
    // `addContext` also records the cold start flag for this execution environment.
    logger.addContext(context);
    logger.appendKeys({ correlationId: resolveCorrelationId(event, context) });

    if (options.logEvent ?? logger.getLogEvent()) {
      logger.info("Lambda invocation event", { event });
    } else {
      logger.debug("Lambda invocation event", { event });
    }

    try {
      return await handler(event, context);
    } catch (error) {
      logger.error("Unhandled error in handler", toError(error));
      if (options.onError) {
        return await options.onError(error, event, context);
      }
      throw error;
    } finally {
      logger.removeKeys(["correlationId"]);
      logger.resetKeys();
    }
  };
}

export type HttpHandler = LambdaHandler<APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2>;

export type WithHttpHandlerOptions = WithHandlerOptions<
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2
>;

const withCorrelationHeader = (
  result: APIGatewayProxyStructuredResultV2,
  correlationId: string,
): APIGatewayProxyStructuredResultV2 => ({
  ...result,
  headers: { ...result.headers, [CORRELATION_ID_HEADER]: correlationId },
});

/**
 * HTTP API (payload v2) handler wrapper. {@link HttpError}s become JSON error
 * responses with their status code; anything else becomes a 500. Every response
 * carries an `x-correlation-id` header.
 */
export function withHttpHandler(
  handler: HttpHandler,
  options: WithHttpHandlerOptions = {},
): HttpHandler {
  const inner: HttpHandler = async (event, context) => {
    const logger = options.logger ?? getLogger();
    const correlationId = resolveCorrelationId(event, context);
    try {
      return withCorrelationHeader(await handler(event, context), correlationId);
    } catch (error) {
      if (!isHttpError(error)) throw error;
      logger.warn("Request failed", {
        statusCode: error.statusCode,
        error: error.message,
        details: error.details,
      });
      return withCorrelationHeader(
        json(error.statusCode, { error: error.message, details: error.details }),
        correlationId,
      );
    }
  };

  return withHandler(inner, {
    ...options,
    onError: async (error, event, context) => {
      const response = options.onError
        ? await options.onError(error, event, context)
        : json(500, { error: "Internal Server Error" });
      return withCorrelationHeader(response, resolveCorrelationId(event, context));
    },
  });
}

export type SqsRecordHandler = (record: SQSRecord, context: Context) => Promise<void>;

export interface WithSqsHandlerOptions {
  /** Logger to use; defaults to {@link getLogger}. */
  logger?: Logger;
  /** Log the incoming event at `info` level. */
  logEvent?: boolean;
  /** Maximum number of records processed concurrently (default 1 = sequential). */
  concurrency?: number;
}

/**
 * SQS handler wrapper with partial batch responses: each record is handed to
 * `recordHandler`; failures are logged and reported via `batchItemFailures`.
 * Requires `ReportBatchItemFailures` on the event source mapping.
 */
export function withSqsHandler(
  recordHandler: SqsRecordHandler,
  options: WithSqsHandlerOptions = {},
): LambdaHandler<SQSEvent, SQSBatchResponse> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));

  const inner: LambdaHandler<SQSEvent, SQSBatchResponse> = async (event, context) => {
    const logger = options.logger ?? getLogger();
    const records = event.Records;
    const batchItemFailures: SQSBatchItemFailure[] = [];
    let next = 0;

    const worker = async (): Promise<void> => {
      while (next < records.length) {
        const record = records[next];
        next += 1;
        if (!record) continue;
        try {
          await recordHandler(record, context);
        } catch (error) {
          logger.error("SQS record failed", {
            messageId: record.messageId,
            error: toError(error),
          });
          batchItemFailures.push({ itemIdentifier: record.messageId });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, records.length) }, () => worker()),
    );
    return { batchItemFailures };
  };

  const handlerOptions: WithHandlerOptions<SQSEvent, SQSBatchResponse> = {};
  if (options.logger) handlerOptions.logger = options.logger;
  if (options.logEvent !== undefined) handlerOptions.logEvent = options.logEvent;
  return withHandler(inner, handlerOptions);
}

export type PlatformEventHandler<T> = (
  envelope: PlatformEvent<T>,
  event: EventBridgeEvent<string, unknown>,
  context: Context,
) => Promise<void>;

export interface WithEventHandlerOptions<T> {
  /** Logger to use; defaults to {@link getLogger}. */
  logger?: Logger;
  /** Log the incoming event at `info` level. */
  logEvent?: boolean;
  /** Validates / narrows the event body, e.g. `schema.parse` from zod. */
  parse?: (body: unknown) => T;
  /** Custom S3 client used to download offloaded bodies. */
  s3Client?: S3Client;
}

/**
 * EventBridge handler wrapper: unwraps (and, when offloaded, downloads) the
 * platform envelope before invoking `handler`. Adds `eventName` to the log keys.
 */
export function withEventHandler<T = unknown>(
  handler: PlatformEventHandler<T>,
  options: WithEventHandlerOptions<T> = {},
): LambdaHandler<EventBridgeEvent<string, unknown>, void> {
  const inner: LambdaHandler<EventBridgeEvent<string, unknown>, void> = async (event, context) => {
    const logger = options.logger ?? getLogger();
    const resolveOptions: { parse?: (body: unknown) => T; s3Client?: S3Client } = {};
    if (options.parse) resolveOptions.parse = options.parse;
    if (options.s3Client) resolveOptions.s3Client = options.s3Client;
    const envelope = await resolveEnvelope<T>(event, resolveOptions);
    logger.appendKeys({ eventName: envelope.eventName });
    await handler(envelope, event, context);
  };

  const handlerOptions: WithHandlerOptions<EventBridgeEvent<string, unknown>, void> = {};
  if (options.logger) handlerOptions.logger = options.logger;
  if (options.logEvent !== undefined) handlerOptions.logEvent = options.logEvent;
  return withHandler(inner, handlerOptions);
}
