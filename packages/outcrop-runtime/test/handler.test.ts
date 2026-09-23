/* eslint-disable @typescript-eslint/require-await -- handler doubles are async by contract */
import type { SQSEvent } from "aws-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import {
  resolveCorrelationId,
  withEventHandler,
  withHandler,
  withHttpHandler,
  withSqsHandler,
} from "../src/handler";
import { json, notFound } from "../src/http";
import { createLogger, resetLogger } from "../src/logger";
import {
  PLATFORM_VARS,
  eventBridgeEvent,
  fakeContext,
  httpEvent,
  parseLogs,
  restoreEnv,
  s3Body,
  setEnv,
  snapshotEnv,
  sqsRecord,
} from "./helpers";

const s3Mock = mockClient(S3Client);

describe("handler wrappers", () => {
  let info: jest.SpyInstance;
  let debug: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    snapshotEnv();
    setEnv(PLATFORM_VARS);
    resetLogger();
    s3Mock.reset();
    info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    debug = jest.spyOn(console, "debug").mockImplementation(() => undefined);
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    error = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    restoreEnv();
    resetLogger();
  });

  describe("resolveCorrelationId", () => {
    const context = fakeContext();

    it("prefers the header, then request id, then event id, then aws request id", () => {
      expect(
        resolveCorrelationId(httpEvent({ headers: { "X-Correlation-ID": "hdr" } }), context),
      ).toBe("hdr");
      expect(resolveCorrelationId(httpEvent(), context)).toBe("http-request-id");
      expect(resolveCorrelationId(eventBridgeEvent({}), context)).toBe("event-id-1");
      expect(resolveCorrelationId({ Records: [] }, context)).toBe("aws-request-id");
      expect(resolveCorrelationId(null, context)).toBe("aws-request-id");
    });
  });

  describe("withHandler", () => {
    it("adds context, correlation id and cold start, then cleans up", async () => {
      // Powertools only reports cold starts for on-demand initialisation.
      setEnv({ AWS_LAMBDA_INITIALIZATION_TYPE: "on-demand" });
      const logger = createLogger();
      const handler = withHandler(
        async (event: { value: number }) => {
          logger.info("inside");
          return event.value * 2;
        },
        { logger },
      );

      expect(await handler({ value: 21 }, fakeContext())).toBe(42);

      const [eventLog] = parseLogs(debug);
      expect(eventLog).toMatchObject({
        message: "Lambda invocation event",
        event: { value: 21 },
        correlationId: "aws-request-id",
      });
      const [inside] = parseLogs(info);
      expect(inside).toMatchObject({
        message: "inside",
        correlationId: "aws-request-id",
        function_name: "orders-api",
        function_request_id: "aws-request-id",
        cold_start: true,
      });

      logger.info("after");
      expect(parseLogs(info)[1]).not.toHaveProperty("correlationId");

      await handler({ value: 1 }, fakeContext({ awsRequestId: "second" }));
      const second = parseLogs(info).find((log) => log["correlationId"] === "second");
      expect(second).toMatchObject({ cold_start: false });
    });

    it("logs the event at info when POWERTOOLS_LOGGER_LOG_EVENT is set", async () => {
      setEnv({ POWERTOOLS_LOGGER_LOG_EVENT: "true" });
      const handler = withHandler(async () => "ok", { logger: createLogger() });
      await handler({ hello: "world" }, fakeContext());
      expect(parseLogs(info)[0]).toMatchObject({
        message: "Lambda invocation event",
        event: { hello: "world" },
      });
    });

    it("logs and rethrows errors", async () => {
      const handler = withHandler(
        async () => {
          throw new Error("boom");
        },
        { logger: createLogger() },
      );
      await expect(handler({}, fakeContext())).rejects.toThrow("boom");
      const [log] = parseLogs(error);
      expect(log).toMatchObject({
        message: "Unhandled error in handler",
        error: { name: "Error", message: "boom" },
      });
      expect(JSON.stringify((log!["error"] as { stack: unknown }).stack)).toContain(
        "handler.test.ts",
      );
    });

    it("delegates to onError when provided", async () => {
      const onError = jest.fn((err: unknown) => `handled:${(err as Error).message}`);
      const handler = withHandler<Record<string, never>, string>(
        async () => {
          throw new Error("boom");
        },
        { logger: createLogger(), onError },
      );
      expect(await handler({}, fakeContext())).toBe("handled:boom");
      expect(onError).toHaveBeenCalledTimes(1);
    });
  });

  describe("withHttpHandler", () => {
    it("adds the correlation header to successful responses", async () => {
      const handler = withHttpHandler(async (event) => json(200, { path: event.rawPath }), {
        logger: createLogger(),
      });
      const response = await handler(
        httpEvent({ headers: { "x-correlation-id": "corr-1" } }),
        fakeContext(),
      );
      expect(response).toEqual({
        statusCode: 200,
        headers: { "content-type": "application/json", "x-correlation-id": "corr-1" },
        body: '{"path":"/orders/42"}',
      });
    });

    it("maps HttpError to a JSON error response and logs a warning", async () => {
      const handler = withHttpHandler(
        async () => {
          throw notFound("Order not found", { id: "42" });
        },
        { logger: createLogger() },
      );
      const response = await handler(httpEvent(), fakeContext());
      expect(response.statusCode).toBe(404);
      expect(response.headers).toMatchObject({ "x-correlation-id": "http-request-id" });
      expect(JSON.parse(response.body!)).toEqual({
        error: "Order not found",
        details: { id: "42" },
      });
      expect(parseLogs(warn)[0]).toMatchObject({ message: "Request failed", statusCode: 404 });
      expect(error).not.toHaveBeenCalled();
    });

    it("maps unknown errors to 500 and logs the stack", async () => {
      const handler = withHttpHandler(
        async () => {
          throw new TypeError("kaboom");
        },
        { logger: createLogger() },
      );
      const response = await handler(httpEvent(), fakeContext());
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body!)).toEqual({ error: "Internal Server Error" });
      expect(response.headers).toMatchObject({ "x-correlation-id": "http-request-id" });
      const [log] = parseLogs(error);
      expect(log).toMatchObject({ error: { name: "TypeError", message: "kaboom" } });
      expect(JSON.stringify((log!["error"] as { stack: unknown }).stack)).toContain(
        "handler.test.ts",
      );
    });

    it("lets a custom onError produce the response", async () => {
      const handler = withHttpHandler(
        async () => {
          throw new Error("x");
        },
        { logger: createLogger(), onError: () => json(503, { error: "Down" }) },
      );
      const response = await handler(httpEvent(), fakeContext());
      expect(response.statusCode).toBe(503);
      expect(response.headers).toMatchObject({ "x-correlation-id": "http-request-id" });
    });
  });

  describe("withSqsHandler", () => {
    const event: SQSEvent = {
      Records: [sqsRecord("1", "m1"), sqsRecord("2", "m2"), sqsRecord("3", "m3")],
    };

    it("reports failed records as batch item failures", async () => {
      const seen: string[] = [];
      const handler = withSqsHandler(
        async (record) => {
          seen.push(record.messageId);
          if (record.messageId === "m2") throw new Error("bad record");
        },
        { logger: createLogger() },
      );

      const response = await handler(event, fakeContext());
      expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: "m2" }] });
      expect(seen).toEqual(["m1", "m2", "m3"]);
      expect(parseLogs(error)[0]).toMatchObject({
        message: "SQS record failed",
        messageId: "m2",
        error: { message: "bad record" },
      });
    });

    it("respects the concurrency limit", async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const handler = withSqsHandler(
        async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight -= 1;
        },
        { logger: createLogger(), concurrency: 2 },
      );

      const response = await handler(event, fakeContext());
      expect(response.batchItemFailures).toEqual([]);
      expect(maxInFlight).toBe(2);
    });

    it("handles empty batches", async () => {
      const handler = withSqsHandler(async () => undefined, { logger: createLogger() });
      expect(await handler({ Records: [] }, fakeContext())).toEqual({ batchItemFailures: [] });
    });
  });

  describe("withEventHandler", () => {
    it("unwraps the envelope, applies parse and adds eventName to the logs", async () => {
      const logger = createLogger();
      const received: unknown[] = [];
      const handler = withEventHandler<{ id: string }>(
        async (envelope, event) => {
          logger.info("handling");
          received.push(envelope, event["detail-type"]);
        },
        { logger, parse: (body) => ({ id: String((body as { id: number }).id) }) },
      );

      const event = eventBridgeEvent({ eventName: "OrderCreated", eventBody: { id: 7 } });
      await handler(event, fakeContext());

      expect(received).toEqual([
        { eventName: "OrderCreated", eventBody: { id: "7" } },
        "OrderCreated",
      ]);
      expect(parseLogs(info)[0]).toMatchObject({
        message: "handling",
        eventName: "OrderCreated",
        correlationId: "event-id-1",
      });
    });

    it("downloads offloaded bodies", async () => {
      s3Mock.on(GetObjectCommand).resolves({ Body: s3Body('{"big":1}') });
      const bodies: unknown[] = [];
      const handler = withEventHandler(
        async (envelope) => {
          bodies.push(envelope.eventBody);
        },
        { logger: createLogger(), s3Client: new S3Client({}) },
      );
      await handler(
        eventBridgeEvent({ eventName: "Big", offloaded: { bucket: "b", key: "k" } }),
        fakeContext(),
      );
      expect(bodies).toEqual([{ big: 1 }]);
    });

    it("rejects invalid envelopes", async () => {
      const handler = withEventHandler(async () => undefined, { logger: createLogger() });
      await expect(handler(eventBridgeEvent({ nope: true }), fakeContext())).rejects.toThrow(
        /eventName/,
      );
    });
  });
});
