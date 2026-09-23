import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { flattenOutputs, stackOutputsCommand } from "../src/commands/stack-outputs";
import { capture } from "./helpers";

const tmp = (): string => mkdtempSync(path.join(os.tmpdir(), "pcdk-"));

describe("stack-outputs", () => {
  it("flattens outputs with a prefix", () => {
    expect(
      flattenOutputs({ A: { ApiBaseUrl: "https://a.example.com" }, B: { Id: "1" } }, "PREVIEW_"),
    ).toEqual({
      PREVIEW_ApiBaseUrl: "https://a.example.com",
      PREVIEW_Id: "1",
    });
  });

  it("reads a cdk outputs file and exports to GitHub files", async () => {
    const dir = tmp();
    const outputsFile = path.join(dir, "cdk-outputs.json");
    writeFileSync(
      outputsFile,
      JSON.stringify({ "abc-123-Orders": { ApiBaseUrl: "https://x.example.com", ApiId: "id" } }),
    );
    const envFile = path.join(dir, "env");
    const outFile = path.join(dir, "out");
    const io = capture({ GITHUB_ENV: envFile, GITHUB_OUTPUT: outFile });
    const code = await stackOutputsCommand(
      [
        "--outputs-file",
        outputsFile,
        "--prefix",
        "PREVIEW_",
        "--github-env",
        "--github-output",
        "--json",
        path.join(dir, "o.json"),
      ],
      io,
    );
    expect(code).toBe(0);
    expect(io.stdout).toEqual(["PREVIEW_ApiBaseUrl=https://x.example.com", "PREVIEW_ApiId=id"]);
    expect(readFileSync(envFile, "utf8")).toContain("PREVIEW_ApiBaseUrl=https://x.example.com\n");
    const out = readFileSync(outFile, "utf8");
    expect(out).toContain("stack-names=abc-123-Orders\n");
    expect(out).toContain("outputs-json=");
    expect(JSON.parse(readFileSync(path.join(dir, "o.json"), "utf8"))).toHaveProperty(
      "abc-123-Orders",
    );
  });

  it("describes stacks through the injected client", async () => {
    const io = capture({ AWS_REGION: "eu-west-1" });
    const seen: string[] = [];
    const code = await stackOutputsCommand(["--stack", "Orders", "--stack", "OrdersApi"], io, {
      describeStack: (name, region) => {
        seen.push(`${name}@${region ?? ""}`);
        return Promise.resolve([
          { OutputKey: "Url", OutputValue: `https://${name.toLowerCase()}.example.com` },
        ]);
      },
    });
    expect(code).toBe(0);
    expect(seen).toEqual(["Orders@eu-west-1", "OrdersApi@eu-west-1"]);
    // Identical keys across stacks collapse; the last stack wins.
    expect(io.stdout).toEqual(["Url=https://ordersapi.example.com"]);
  });

  it("requires a source", async () => {
    await expect(stackOutputsCommand([], capture())).rejects.toThrow(
      /--stack <name> or --outputs-file/,
    );
  });
});
