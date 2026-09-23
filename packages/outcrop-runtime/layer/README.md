# Platform telemetry layer

`nodejs/platform-telemetry.js` is a small, dependency-free CommonJS script that is
shipped as a Lambda layer and pre-loaded into the Node.js runtime with

```text
NODE_OPTIONS=--require /opt/nodejs/platform-telemetry.js
```

## What it does

When active, it wraps `process.stdout.write` and `process.stderr.write`. Every
line that parses as a JSON **object** (i.e. a structured log record from
Powertools Logger or any other JSON logger) is written directly to the Lambda
Telemetry API file descriptor (`_LAMBDA_TELEMETRY_LOG_FD`) using the runtime's
log frame format:

| Offset | Size     | Field                                        |
| ------ | -------- | -------------------------------------------- |
| 0      | 4 bytes  | frame type, big-endian (`0xa55a0003` = JSON) |
| 4      | 4 bytes  | payload length in bytes, big-endian          |
| 8      | 8 bytes  | timestamp in microseconds, big-endian        |
| 16     | _length_ | UTF-8 JSON payload                           |

Lines that are not a JSON object (plain `console.log` text, stack traces, ...)
are passed through to the original stream unchanged, so nothing is lost.

Writing frames directly avoids the runtime re-encoding each stdout line, keeps
the JSON exactly as emitted and preserves the function's own timestamps for
Telemetry API subscribers (log forwarders, extensions) and CloudWatch Logs.

## Opt-in

The shim is **inert by default**. It only patches the streams when **both** of
the following are true:

- `PLATFORM_TELEMETRY_FD=1` is set in the function environment, and
- `_LAMBDA_TELEMETRY_LOG_FD` is present (the Lambda runtime provides it).

Outside Lambda, or with `PLATFORM_TELEMETRY_FD` unset, requiring the script is
a no-op.

## Safety

Every code path is wrapped in `try/catch`. If framing or writing to the file
descriptor fails for any reason, the original `write` is called with the
original chunk, so logging can never break a function.

## Using it from CDK

```ts
import { TELEMETRY_LAYER_DIR, TELEMETRY_NODE_OPTIONS } from "@rpallas/outcrop-runtime/layer";

const layer = new lambda.LayerVersion(this, "Telemetry", {
  code: lambda.Code.fromAsset(TELEMETRY_LAYER_DIR),
  compatibleRuntimes: [lambda.Runtime.NODEJS_22_X],
});

fn.addLayers(layer);
fn.addEnvironment("NODE_OPTIONS", TELEMETRY_NODE_OPTIONS);
fn.addEnvironment("PLATFORM_TELEMETRY_FD", "1");
```
