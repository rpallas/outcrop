import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TELEMETRY_LAYER_DIR, TELEMETRY_NODE_OPTIONS, TELEMETRY_REQUIRE_PATH } from "../src/layer";
import { restoreEnv, setEnv, snapshotEnv } from "./helpers";

const SCRIPT = path.join(TELEMETRY_LAYER_DIR, "nodejs", "platform-telemetry.js");
const FRAME_TYPE_JSON = 0xa55a0003;

type StreamWrite = typeof process.stdout.write;

/** Decodes every telemetry frame in `buffer`. */
const decodeFrames = (
  buffer: Buffer,
): { type: number; length: number; timestampUs: bigint; payload: string }[] => {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const type = buffer.readUInt32BE(offset);
    const length = buffer.readUInt32BE(offset + 4);
    const timestampUs = buffer.readBigUInt64BE(offset + 8);
    const payload = buffer.subarray(offset + 16, offset + 16 + length).toString("utf8");
    frames.push({ type, length, timestampUs, payload });
    offset += 16 + length;
  }
  return frames;
};

describe("layer exports", () => {
  it("points at the layer directory and require path", () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(fs.existsSync(path.join(TELEMETRY_LAYER_DIR, "README.md"))).toBe(true);
    expect(TELEMETRY_REQUIRE_PATH).toBe("/opt/nodejs/platform-telemetry.js");
    expect(TELEMETRY_NODE_OPTIONS).toBe("--require /opt/nodejs/platform-telemetry.js");
  });
});

describe("platform-telemetry.js", () => {
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  let tmpDir: string;
  let tmpFile: string;
  let fd: number;

  beforeEach(() => {
    snapshotEnv();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "platform-telemetry-"));
    tmpFile = path.join(tmpDir, "telemetry.log");
    fd = fs.openSync(tmpFile, "w+");
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    fs.closeSync(fd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    restoreEnv();
  });

  it("frames JSON lines to the telemetry fd and passes other lines through", () => {
    setEnv({ PLATFORM_TELEMETRY_FD: "1", _LAMBDA_TELEMETRY_LOG_FD: String(fd) });
    const stdoutSink = jest.fn<boolean, Parameters<StreamWrite>>(() => true);
    const stderrSink = jest.fn<boolean, Parameters<StreamWrite>>(() => true);
    process.stdout.write = stdoutSink as unknown as StreamWrite;
    process.stderr.write = stderrSink as unknown as StreamWrite;

    const before = Date.now();
    jest.isolateModules(() => {
      jest.requireActual(SCRIPT);
    });
    expect(process.stdout.write).not.toBe(stdoutSink);

    const record = { level: "INFO", message: "hello", service: "orders" };
    process.stdout.write(`${JSON.stringify(record)}\n`);
    process.stdout.write("plain text line\n");
    process.stdout.write(`${JSON.stringify({ a: 1 })}\nnot json\n`);
    process.stderr.write(`${JSON.stringify({ level: "ERROR" })}\n`);
    process.stdout.write("[1,2,3]\n");
    process.stdout.write(Buffer.from("buffer line\n"));
    const after = Date.now();

    const frames = decodeFrames(fs.readFileSync(tmpFile));
    expect(frames).toHaveLength(3);
    expect(frames.map((frame) => frame.type)).toEqual([
      FRAME_TYPE_JSON,
      FRAME_TYPE_JSON,
      FRAME_TYPE_JSON,
    ]);
    expect(frames[0]!.length).toBe(Buffer.byteLength(JSON.stringify(record)));
    expect(JSON.parse(frames[0]!.payload)).toEqual(record);
    expect(JSON.parse(frames[1]!.payload)).toEqual({ a: 1 });
    expect(JSON.parse(frames[2]!.payload)).toEqual({ level: "ERROR" });
    expect(frames[0]!.timestampUs).toBeGreaterThanOrEqual(BigInt(before) * 1000n);
    expect(frames[0]!.timestampUs).toBeLessThanOrEqual(BigInt(after) * 1000n);

    const passedThrough = stdoutSink.mock.calls.map((call) => String(call[0]));
    expect(passedThrough).toEqual([
      "plain text line\n",
      "not json\n",
      "[1,2,3]\n",
      "buffer line\n",
    ]);
    expect(stderrSink).not.toHaveBeenCalled();
  });

  it("invokes write callbacks for fully framed chunks", async () => {
    setEnv({ PLATFORM_TELEMETRY_FD: "1", _LAMBDA_TELEMETRY_LOG_FD: String(fd) });
    process.stdout.write = jest.fn(() => true);
    jest.isolateModules(() => {
      jest.requireActual(SCRIPT);
    });

    await new Promise<void>((resolve) => {
      process.stdout.write('{"ok":true}\n', () => {
        resolve();
      });
    });
    expect(decodeFrames(fs.readFileSync(tmpFile))).toHaveLength(1);
  });

  it("stays inert unless explicitly enabled", () => {
    setEnv({ PLATFORM_TELEMETRY_FD: undefined, _LAMBDA_TELEMETRY_LOG_FD: String(fd) });
    const sink = jest.fn(() => true) as unknown as StreamWrite;
    process.stdout.write = sink;
    jest.isolateModules(() => {
      jest.requireActual(SCRIPT);
    });
    expect(process.stdout.write).toBe(sink);

    setEnv({ PLATFORM_TELEMETRY_FD: "1", _LAMBDA_TELEMETRY_LOG_FD: undefined });
    jest.isolateModules(() => {
      jest.requireActual(SCRIPT);
    });
    expect(process.stdout.write).toBe(sink);
  });
});
