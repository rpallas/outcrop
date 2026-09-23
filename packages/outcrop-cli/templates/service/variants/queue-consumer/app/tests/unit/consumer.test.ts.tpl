import type { Context, SQSEvent, SQSRecord } from "aws-lambda";
import { handler } from "../../src/handlers/consumer";

const context = { awsRequestId: "req-1", functionName: "test" } as Context;

const record = (messageId: string, body: unknown): SQSRecord =>
  ({ messageId, body: JSON.stringify(body), receiptHandle: "r", attributes: {}, messageAttributes: {} }) as unknown as SQSRecord;

describe("consumer", () => {
  it("reports only failed records", async () => {
    const event: SQSEvent = { Records: [record("ok", { id: "1", type: "email" }), record("bad", { nope: true })] };
    const response = await handler(event, context);
    expect(response.batchItemFailures).toEqual([{ itemIdentifier: "bad" }]);
  });
});
