import type { Context } from "aws-lambda";
import { handler } from "../../src/handlers/scheduled";

const context = { awsRequestId: "req-1", functionName: "test" } as Context;

describe("scheduled job", () => {
  it("runs and reports what it processed", async () => {
    await expect(handler({ time: "2026-01-01T02:00:00Z" }, context)).resolves.toEqual({ processed: 0 });
  });
});
