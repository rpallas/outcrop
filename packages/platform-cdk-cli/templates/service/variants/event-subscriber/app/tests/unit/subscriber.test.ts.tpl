import type { Context, EventBridgeEvent } from "aws-lambda";
import { handler } from "../../src/handlers/subscriber";

const context = { awsRequestId: "req-1", functionName: "test" } as Context;

const event = (eventName: string, eventBody: unknown): EventBridgeEvent<string, unknown> =>
  ({
    id: "1",
    version: "0",
    account: "111111111111",
    time: new Date().toISOString(),
    region: "eu-west-1",
    resources: [],
    source: "{{service}}",
    "detail-type": eventName,
    detail: { eventName, eventBody },
  }) as EventBridgeEvent<string, unknown>;

describe("subscriber", () => {
  it("handles known and unknown events", async () => {
    await expect(handler(event("example.created", { id: "a" }), context)).resolves.toBeUndefined();
    await expect(handler(event("something.else", { id: "b" }), context)).resolves.toBeUndefined();
  });
});
