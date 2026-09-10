import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import type { APIGatewayProxyEventV2, Context, EventBridgeEvent, SQSRecord } from "aws-lambda";

/** Minimal stand-in for an S3 `GetObject` body stream. */
export const s3Body = (contents: string): NonNullable<GetObjectCommandOutput["Body"]> =>
  ({ transformToString: () => Promise.resolve(contents) }) as unknown as NonNullable<
    GetObjectCommandOutput["Body"]
  >;

/** Snapshot of `process.env` restored by {@link restoreEnv}. */
let savedEnv: NodeJS.ProcessEnv | undefined;

export const snapshotEnv = (): void => {
  savedEnv = { ...process.env };
};

export const restoreEnv = (): void => {
  if (!savedEnv) return;
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) Reflect.deleteProperty(process.env, key);
  }
  Object.assign(process.env, savedEnv);
  savedEnv = undefined;
};

export const setEnv = (vars: Record<string, string | undefined>): void => {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
};

/** Standard platform variables used across tests. */
export const PLATFORM_VARS: Record<string, string> = {
  POWERTOOLS_DEV: "true",
  PLATFORM_PROJECT: "shop",
  PLATFORM_SERVICE: "orders",
  PLATFORM_ENV: "dev",
  PLATFORM_FUNCTION: "api",
  LOG_LEVEL: "debug",
};

export const fakeContext = (overrides: Partial<Context> = {}): Context => ({
  callbackWaitsForEmptyEventLoop: false,
  functionName: "orders-api",
  functionVersion: "$LATEST",
  invokedFunctionArn: "arn:aws:lambda:eu-west-1:111111111111:function:orders-api",
  memoryLimitInMB: "256",
  awsRequestId: "aws-request-id",
  logGroupName: "/aws/lambda/orders-api",
  logStreamName: "2026/09/10/[$LATEST]abc",
  getRemainingTimeInMillis: () => 30_000,
  done: () => undefined,
  fail: () => undefined,
  succeed: () => undefined,
  ...overrides,
});

export const httpEvent = (
  overrides: Partial<APIGatewayProxyEventV2> = {},
): APIGatewayProxyEventV2 => ({
  version: "2.0",
  routeKey: "GET /orders/{id}",
  rawPath: "/orders/42",
  rawQueryString: "",
  headers: {},
  requestContext: {
    accountId: "111111111111",
    apiId: "api123",
    domainName: "api.example.com",
    domainPrefix: "api",
    http: {
      method: "GET",
      path: "/orders/42",
      protocol: "HTTP/1.1",
      sourceIp: "127.0.0.1",
      userAgent: "jest",
    },
    requestId: "http-request-id",
    routeKey: "GET /orders/{id}",
    stage: "$default",
    time: "10/Sep/2026:21:00:00 +0000",
    timeEpoch: 1_789_000_000_000,
  },
  isBase64Encoded: false,
  ...overrides,
});

export const eventBridgeEvent = (
  detail: unknown,
  overrides: Partial<EventBridgeEvent<string, unknown>> = {},
): EventBridgeEvent<string, unknown> => ({
  id: "event-id-1",
  version: "0",
  account: "111111111111",
  time: "2026-09-10T21:00:00Z",
  region: "eu-west-1",
  resources: [],
  source: "orders",
  "detail-type": "OrderCreated",
  detail,
  ...overrides,
});

export const sqsRecord = (body: string, messageId = "message-1"): SQSRecord => ({
  messageId,
  receiptHandle: "receipt",
  body,
  attributes: {
    ApproximateReceiveCount: "1",
    SentTimestamp: "1789000000000",
    SenderId: "sender",
    ApproximateFirstReceiveTimestamp: "1789000000000",
  },
  messageAttributes: {},
  md5OfBody: "",
  eventSource: "aws:sqs",
  eventSourceARN: "arn:aws:sqs:eu-west-1:111111111111:orders-queue",
  awsRegion: "eu-west-1",
});

/** Parses the JSON log records captured by a console spy. */
export const parseLogs = (spy: jest.SpyInstance): Record<string, unknown>[] =>
  spy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
