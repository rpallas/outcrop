import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import {
  parseEnvelope,
  parseSqsEnvelope,
  publishEvent,
  publishEvents,
  resolveEnvelope,
  resolveSqsEnvelope,
} from "../src/events";
import { eventBridgeEvent, restoreEnv, s3Body, setEnv, snapshotEnv, sqsRecord } from "./helpers";

const ebMock = mockClient(EventBridgeClient);
const s3Mock = mockClient(S3Client);

describe("publishEvent", () => {
  beforeEach(() => {
    snapshotEnv();
    ebMock.reset();
    s3Mock.reset();
    setEnv({ PLATFORM_SERVICE: "orders", EVENT_BUS_NAME: "platform-dev" });
  });

  afterEach(restoreEnv);

  it("publishes an envelope with defaults from the environment", async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: "evt-1" }] });

    const result = await publishEvent("OrderCreated", { orderId: "42" });

    expect(result).toEqual({ eventId: "evt-1" });
    const input = ebMock.commandCalls(PutEventsCommand)[0]!.args[0].input;
    expect(input.Entries).toHaveLength(1);
    const entry = input.Entries![0]!;
    expect(entry).toMatchObject({
      EventBusName: "platform-dev",
      Source: "orders",
      DetailType: "OrderCreated",
    });
    expect(JSON.parse(entry.Detail!)).toEqual({
      eventName: "OrderCreated",
      eventBody: { orderId: "42" },
    });
  });

  it("honours explicit options", async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });
    const time = new Date("2026-09-10T20:00:00Z");
    const client = new EventBridgeClient({});

    const result = await publishEvent("A", 1, {
      busName: "other-bus",
      source: "billing",
      resources: ["arn:aws:s3:::bucket"],
      time,
      client,
    });

    expect(result).toEqual({});
    const entry = ebMock.commandCalls(PutEventsCommand)[0]!.args[0].input.Entries![0]!;
    expect(entry).toMatchObject({
      EventBusName: "other-bus",
      Source: "billing",
      Resources: ["arn:aws:s3:::bucket"],
      Time: time,
    });
  });

  it("throws when no bus or source is configured", async () => {
    setEnv({ EVENT_BUS_NAME: undefined });
    await expect(publishEvent("A", {})).rejects.toThrow(/EVENT_BUS_NAME/);
    setEnv({ EVENT_BUS_NAME: "bus", PLATFORM_SERVICE: undefined });
    await expect(publishEvent("A", {})).rejects.toThrow(/PLATFORM_SERVICE/);
  });

  it("throws when EventBridge reports failed entries", async () => {
    ebMock.on(PutEventsCommand).resolves({
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: "ThrottlingException", ErrorMessage: "slow down" }],
    });
    await expect(publishEvent("A", {})).rejects.toThrow(
      "Failed to publish 1 of 1 event(s): ThrottlingException: slow down",
    );
  });

  it("offloads large bodies to S3 and publishes a pointer", async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: "e" }] });
    s3Mock.on(PutObjectCommand).resolves({});
    const body = { blob: "x".repeat(500) };

    await publishEvent("BigThing", body, {
      offload: { bucket: "events-bucket", thresholdBytes: 100 },
    });

    const put = s3Mock.commandCalls(PutObjectCommand)[0]!.args[0].input;
    expect(put.Bucket).toBe("events-bucket");
    expect(put.Key).toMatch(/^events\/BigThing\/[0-9a-f-]{36}\.json$/);
    expect(put.Body).toBe(JSON.stringify(body));

    const detail = JSON.parse(
      ebMock.commandCalls(PutEventsCommand)[0]!.args[0].input.Entries![0]!.Detail!,
    ) as Record<string, unknown>;
    expect(detail).toEqual({
      eventName: "BigThing",
      offloaded: { bucket: "events-bucket", key: put.Key },
    });
  });

  it("does not offload small bodies", async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });
    await publishEvent("Small", { a: 1 }, { offload: { bucket: "events-bucket" } });
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });
});

describe("publishEvents", () => {
  beforeEach(() => {
    snapshotEnv();
    ebMock.reset();
    setEnv({ PLATFORM_SERVICE: "orders", EVENT_BUS_NAME: "platform-dev" });
  });

  afterEach(restoreEnv);

  it("batches entries in groups of ten and preserves order", async () => {
    ebMock.on(PutEventsCommand).callsFake((input: { Entries: unknown[] }) => ({
      FailedEntryCount: 0,
      Entries: input.Entries.map((_, index) => ({ EventId: `id-${index}` })),
    }));

    const events = Array.from({ length: 23 }, (_, i) => ({ eventName: `E${i}`, eventBody: i }));
    const results = await publishEvents(events);

    const calls = ebMock.commandCalls(PutEventsCommand);
    expect(calls.map((call) => call.args[0].input.Entries!.length)).toEqual([10, 10, 3]);
    expect(results).toHaveLength(23);
    expect(results[0]).toEqual({ eventId: "id-0" });
    expect(results[22]).toEqual({ eventId: "id-2" });
    expect(calls[2]!.args[0].input.Entries![2]!.DetailType).toBe("E22");
  });

  it("returns an empty array for no events", async () => {
    expect(await publishEvents([])).toEqual([]);
    expect(ebMock.commandCalls(PutEventsCommand)).toHaveLength(0);
  });
});

describe("parseEnvelope", () => {
  it("returns the envelope and applies parse", () => {
    const event = eventBridgeEvent({ eventName: "OrderCreated", eventBody: { id: "1" } });
    expect(parseEnvelope(event)).toEqual({ eventName: "OrderCreated", eventBody: { id: "1" } });

    const parsed = parseEnvelope(event, (body) => (body as { id: string }).id);
    expect(parsed.eventBody).toBe("1");
  });

  it("rejects invalid envelopes", () => {
    expect(() => parseEnvelope(eventBridgeEvent("nope"))).toThrow(/expected an object/);
    expect(() => parseEnvelope(eventBridgeEvent({ eventBody: 1 }))).toThrow(/eventName/);
    expect(() => parseEnvelope(eventBridgeEvent({ eventName: "X" }))).toThrow(/eventBody/);
    expect(() =>
      parseEnvelope(eventBridgeEvent({ eventName: "X", offloaded: { bucket: "b", key: "k" } })),
    ).toThrow(/use resolveEnvelope/);
  });

  it("parses envelopes delivered via SQS", () => {
    const record = sqsRecord(
      JSON.stringify(eventBridgeEvent({ eventName: "OrderCreated", eventBody: { id: "9" } })),
    );
    expect(parseSqsEnvelope(record)).toEqual({ eventName: "OrderCreated", eventBody: { id: "9" } });

    expect(() => parseSqsEnvelope(sqsRecord("not json"))).toThrow(/body is not JSON/);
    expect(() => parseSqsEnvelope(sqsRecord(JSON.stringify({ foo: 1 })))).toThrow(
      /not an EventBridge event/,
    );
  });
});

describe("resolveEnvelope", () => {
  beforeEach(() => {
    s3Mock.reset();
  });

  it("returns inline bodies without touching S3", async () => {
    const event = eventBridgeEvent({ eventName: "A", eventBody: [1, 2] });
    expect(await resolveEnvelope(event)).toEqual({ eventName: "A", eventBody: [1, 2] });
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it("downloads offloaded bodies and applies parse", async () => {
    s3Mock
      .on(GetObjectCommand, { Bucket: "events-bucket", Key: "events/A/1.json" })
      .resolves({ Body: s3Body(JSON.stringify({ big: true })) });
    const event = eventBridgeEvent({
      eventName: "A",
      offloaded: { bucket: "events-bucket", key: "events/A/1.json" },
    });

    const envelope = await resolveEnvelope(event, {
      parse: (body) => ({ ...(body as Record<string, unknown>), parsed: true }),
    });
    expect(envelope).toEqual({
      eventName: "A",
      eventBody: { big: true, parsed: true },
      offloaded: { bucket: "events-bucket", key: "events/A/1.json" },
    });
  });

  it("fails when the offloaded object is empty", async () => {
    s3Mock.on(GetObjectCommand).resolves({});
    const event = eventBridgeEvent({ eventName: "A", offloaded: { bucket: "b", key: "k" } });
    await expect(resolveEnvelope(event)).rejects.toThrow(/s3:\/\/b\/k is empty/);
  });

  it("resolves offloaded envelopes from SQS records", async () => {
    s3Mock.on(GetObjectCommand).resolves({ Body: s3Body('"payload"') });
    const record = sqsRecord(
      JSON.stringify(eventBridgeEvent({ eventName: "A", offloaded: { bucket: "b", key: "k" } })),
    );
    expect((await resolveSqsEnvelope(record)).eventBody).toBe("payload");
  });
});
