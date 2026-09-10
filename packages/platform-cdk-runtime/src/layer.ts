import path from "node:path";

/**
 * Directory containing the Lambda layer content (`nodejs/platform-telemetry.js`).
 * Point `lambda.Code.fromAsset()` at it when building the layer.
 */
export const TELEMETRY_LAYER_DIR: string = path.join(__dirname, "..", "layer");

/** Path of the telemetry shim once the layer is mounted at `/opt`. */
export const TELEMETRY_REQUIRE_PATH = "/opt/nodejs/platform-telemetry.js";

/** Value for `NODE_OPTIONS` that pre-loads the telemetry shim. */
export const TELEMETRY_NODE_OPTIONS = `--require ${TELEMETRY_REQUIRE_PATH}`;

/** Environment variable that opts a function into the telemetry shim. */
export const TELEMETRY_ENABLE_ENV = "PLATFORM_TELEMETRY_FD";
