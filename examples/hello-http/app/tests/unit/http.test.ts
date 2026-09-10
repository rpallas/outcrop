import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

import { handler } from "../../src/handlers/http";

const ddb = mockClient(DynamoDBDocumentClient);

const context = { awsRequestId: "req-1", functionName: "test" } as Context;

const request = (method: string, path: string, body?: unknown): APIGatewayProxyEventV2 =>
  ({
    version: "2.0",
    routeKey: `${method} ${path.replace(/\/[0-9a-f-]{36}$/, "/{id}")}`,
    rawPath: path,
    rawQueryString: "",
    headers: { "content-type": "application/json" },
    requestContext: {
      http: { method, path },
      requestId: "r-1",
    } as APIGatewayProxyEventV2["requestContext"],
    pathParameters: /\/[0-9a-f-]{36}$/.test(path) ? { id: path.split("/").pop() ?? "" } : undefined,
    isBase64Encoded: false,
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as APIGatewayProxyEventV2;

const invoke = (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> =>
  handler(event, context);

describe("http handler", () => {
  beforeEach(() => {
    process.env["TABLE_NAME"] = "test-table";
    ddb.reset();
    ddb.on(PutCommand).resolves({});
    ddb.on(DeleteCommand).resolves({});
    ddb.on(ScanCommand).resolves({ Items: [] });
    ddb.on(GetCommand).resolves({ Item: undefined });
  });

  it("reports health", async () => {
    const response = await invoke(request("GET", "/health"));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({ ok: true });
  });

  it("creates and validates items", async () => {
    const created = await invoke(request("POST", "/items", { name: "widget" }));
    expect(created.statusCode).toBe(201);
    const bad = await invoke(request("POST", "/items", { nope: true }));
    expect(bad.statusCode).toBe(400);
  });

  it("returns 404 for unknown items", async () => {
    const response = await invoke(request("GET", "/items/00000000-0000-4000-8000-000000000000"));
    expect(response.statusCode).toBe(404);
  });
});
