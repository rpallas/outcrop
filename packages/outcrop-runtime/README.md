# @rpallas/outcrop-runtime

Lambda runtime helpers for services built with `@rpallas/outcrop`: structured
logging, config and secret resolution through the platform SSM contract,
EventBridge envelopes and thin handler wrappers for HTTP, SQS and EventBridge.

The package is CDK-free and depends only on Powertools for AWS Lambda and the AWS
SDK v3 clients it wraps.

```sh
npm install @rpallas/outcrop-runtime
```

## Environment

The platform constructs inject `PLATFORM_PROJECT`, `PLATFORM_SERVICE`, `PLATFORM_ENV`,
`PLATFORM_PREVIEW_ID`, `PLATFORM_SSM_ROOT`, `PLATFORM_FUNCTION` and `LOG_LEVEL`.

```ts
import { platformEnv, requireEnv } from "@rpallas/outcrop-runtime";

const env = platformEnv(); // throws if PLATFORM_SERVICE / PLATFORM_ENV are missing
env.service; // "orders"
env.isPreview; // true inside a preview stack
const table = requireEnv("TABLE_NAME");
```

## Logger

`createLogger()` returns a Powertools `Logger` whose service name and persistent
keys (`env`, `previewId`, `functionName`) come from the platform environment.
`getLogger()` is a lazy module singleton.

```ts
import { getLogger } from "@rpallas/outcrop-runtime";

const logger = getLogger();
logger.info("order created", { orderId });
```

## Parameters

Cached (5 minutes by default) reads of the SSM contract written by
`@rpallas/outcrop-account`.

```ts
import { getParameter, platformParams } from "@rpallas/outcrop-runtime";

const params = platformParams();
const accountId = await params.account.id();
const busName = await params.env().eventBusName(); // env defaults to PLATFORM_ENV
const topic = await params.env("prod").alertTopicArn("critical");
const flag = await params.config("feature-flags");
const apiUrl = await params.service("billing", "api-url");

const raw = await getParameter("/my/own/parameter", { maxAge: 60, decrypt: true });
```

`PlatformParameterPaths` (also exported) builds the same paths without reading them.

## Secrets

```ts
import { getSecret, getSecretJson, getConfig } from "@rpallas/outcrop-runtime";

// A full ARN is read directly; a short name is resolved via /platform/secrets/{name}/arn.
const apiKey = await getSecret("third-party-api-key");
const db = await getSecretJson("database", { parse: DbCredentials.parse }); // e.g. a zod schema
const region = await getConfig("primary-region"); // /platform/config/primary-region
```

## Events

Events are published to EventBridge with `detail-type = eventName`,
`source = PLATFORM_SERVICE` and a `{ eventName, eventBody }` envelope as `detail`.
The bus comes from `EVENT_BUS_NAME` unless `busName` is passed.

```ts
import { publishEvent, publishEvents, parseEnvelope } from "@rpallas/outcrop-runtime";

await publishEvent("OrderCreated", { orderId, total });
await publishEvents(items.map((item) => ({ eventName: "ItemShipped", eventBody: item })));

// Bodies larger than 200 KB can be offloaded to S3; consumers use resolveEnvelope().
await publishEvent("ReportGenerated", report, { offload: { bucket: process.env.EVENTS_BUCKET } });
```

`parseEnvelope` / `parseSqsEnvelope` validate inline envelopes synchronously;
`resolveEnvelope` / `resolveSqsEnvelope` also download offloaded bodies.

## HTTP handler

```ts
import {
  withHttpHandler,
  json,
  parseJsonBody,
  pathParam,
  notFound,
} from "@rpallas/outcrop-runtime";

export const handler = withHttpHandler(async (event) => {
  const id = pathParam(event, "id");
  const body = parseJsonBody(event, UpdateOrder.parse); // 400 on invalid JSON or schema failure
  const order = await orders.update(id, body);
  if (!order) throw notFound("Order not found", { id });
  return json(200, order);
});
```

`HttpError`s become `{ error, details }` JSON responses with their status code;
anything else is logged with its stack and returned as a 500. Every response
carries an `x-correlation-id` header (taken from the request header, the API
Gateway request id or the Lambda request id).

## SQS handler

```ts
import { withSqsHandler, parseSqsEnvelope } from "@rpallas/outcrop-runtime";

export const handler = withSqsHandler(
  async (record) => {
    const { eventName, eventBody } = parseSqsEnvelope(record);
    await process(eventName, eventBody);
  },
  { concurrency: 5 },
);
```

Failed records are logged and returned as `batchItemFailures`; enable
`ReportBatchItemFailures` on the event source mapping.

## EventBridge handler

```ts
import { withEventHandler } from "@rpallas/outcrop-runtime";

export const handler = withEventHandler<OrderCreated>(
  async ({ eventName, eventBody }) => {
    await fulfil(eventBody);
  },
  { parse: OrderCreated.parse },
);
```

## Generic wrapper

`withHandler(fn, { logger?, logEvent?, onError? })` is the building block used by
the wrappers above: it attaches the Lambda context (including cold start) to the
logger, logs the event (`debug`, or `info` when `POWERTOOLS_LOGGER_LOG_EVENT=true`),
adds a per-invocation `correlationId` key, logs and rethrows errors and resets
the temporary keys afterwards.

## Telemetry layer

`@rpallas/outcrop-runtime/layer` exports `TELEMETRY_LAYER_DIR`,
`TELEMETRY_REQUIRE_PATH` and `TELEMETRY_NODE_OPTIONS` for building an opt-in
Lambda layer that writes JSON log lines straight to the Lambda Telemetry API file
descriptor. See [`layer/README.md`](./layer/README.md) for the mechanism.

```ts
import { TELEMETRY_LAYER_DIR, TELEMETRY_NODE_OPTIONS } from "@rpallas/outcrop-runtime/layer";

const layer = new lambda.LayerVersion(this, "Telemetry", {
  code: lambda.Code.fromAsset(TELEMETRY_LAYER_DIR),
});
fn.addLayers(layer);
fn.addEnvironment("NODE_OPTIONS", TELEMETRY_NODE_OPTIONS);
fn.addEnvironment("PLATFORM_TELEMETRY_FD", "1");
```
