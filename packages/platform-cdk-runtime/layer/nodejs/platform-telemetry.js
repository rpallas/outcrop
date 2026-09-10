"use strict";

/**
 * platform-telemetry.js
 *
 * Opt-in shim, loaded with `NODE_OPTIONS=--require /opt/nodejs/platform-telemetry.js`,
 * that routes structured (JSON) log lines straight to the Lambda Telemetry API
 * file descriptor instead of stdout/stderr.
 *
 * Why: when a function writes to stdout the Lambda runtime interface has to
 * re-encode every line before it reaches CloudWatch Logs and Telemetry API
 * subscribers. Writing JSON frames to `_LAMBDA_TELEMETRY_LOG_FD` skips that
 * hop, preserves the original JSON verbatim and keeps the function's own
 * timestamp.
 *
 * Activation requires BOTH of:
 *   - `PLATFORM_TELEMETRY_FD=1` (set by the platform constructs when enabled)
 *   - `_LAMBDA_TELEMETRY_LOG_FD` (provided by the Lambda runtime)
 *
 * Frame format (see "Telemetry API log frames" in the Lambda docs):
 *
 *   +----------------+----------------+--------------------------+-----------+
 *   | uint32 BE type | uint32 BE len  | uint64 BE timestamp (us) |  payload  |
 *   +----------------+----------------+--------------------------+-----------+
 *          4 bytes          4 bytes             8 bytes            len bytes
 *
 *   type 0xa55a0003 = JSON payload
 *
 * Only lines that parse as a JSON *object* are framed; everything else is
 * passed through to the original stream write untouched. Every failure path
 * falls back to the original write so logging can never break the function.
 */
(function install() {
  try {
    if (process.env.PLATFORM_TELEMETRY_FD !== "1") return;
    const rawFd = process.env._LAMBDA_TELEMETRY_LOG_FD;
    if (rawFd === undefined || rawFd === "") return;
    const fd = Number.parseInt(rawFd, 10);
    if (!Number.isInteger(fd) || fd < 0) return;

    const fs = require("node:fs");

    const FRAME_TYPE_JSON = 0xa55a0003;
    const HEADER_LENGTH = 16;
    const PATCHED = Symbol.for("platform-telemetry.patched");

    /** Builds one telemetry frame for a UTF-8 payload buffer. */
    function frame(payload) {
      const header = Buffer.alloc(HEADER_LENGTH);
      header.writeUInt32BE(FRAME_TYPE_JSON, 0);
      header.writeUInt32BE(payload.length, 4);
      header.writeBigUInt64BE(BigInt(Date.now()) * 1000n, 8);
      return Buffer.concat([header, payload]);
    }

    /** True when `line` is a complete JSON object (not an array or scalar). */
    function isJsonObjectLine(line) {
      if (line.length < 2 || line[0] !== "{" || line[line.length - 1] !== "}") return false;
      try {
        const value = JSON.parse(line);
        return typeof value === "object" && value !== null && !Array.isArray(value);
      } catch {
        return false;
      }
    }

    /** Replaces `stream.write` with a version that frames JSON lines. */
    function patch(stream) {
      if (!stream || typeof stream.write !== "function" || stream.write[PATCHED]) return;
      const originalWrite = stream.write.bind(stream);

      const write = function write(chunk, encoding, callback) {
        try {
          if (typeof encoding === "function") {
            callback = encoding;
            encoding = undefined;
          }
          const text =
            typeof chunk === "string"
              ? chunk
              : Buffer.isBuffer(chunk)
                ? chunk.toString("utf8")
                : undefined;
          if (text === undefined) return originalWrite(chunk, encoding, callback);

          const lines = text.split("\n");
          let passthrough = "";
          for (let i = 0; i < lines.length; i += 1) {
            const isLast = i === lines.length - 1;
            const line = lines[i];
            // A trailing "\n" yields an empty final element; it is not a line.
            if (isLast && line === "") continue;
            const trimmed = line.trim();
            if (isJsonObjectLine(trimmed)) {
              fs.writeSync(fd, frame(Buffer.from(trimmed, "utf8")));
            } else {
              passthrough += isLast ? line : line + "\n";
            }
          }

          if (passthrough.length > 0) return originalWrite(passthrough, encoding, callback);
          if (typeof callback === "function") process.nextTick(callback);
          return true;
        } catch {
          // Never let telemetry break logging: fall back to the plain write.
          return originalWrite(chunk, encoding, callback);
        }
      };
      // Mark the replacement so a second `--require` does not wrap it again.
      write[PATCHED] = true;
      stream.write = write;
    }

    patch(process.stdout);
    patch(process.stderr);
  } catch {
    // Installation failed (unexpected runtime); leave the streams untouched.
  }
})();
