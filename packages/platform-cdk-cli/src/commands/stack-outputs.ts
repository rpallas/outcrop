import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  CloudFormationClient,
  DescribeStacksCommand,
  type Output,
} from "@aws-sdk/client-cloudformation";
import { type Io, CliError, appendGitHubFile } from "../io";

export const STACK_OUTPUTS_HELP = `Usage: platform-cdk stack-outputs (--stack <name> ... | --outputs-file <cdk-outputs.json>) [--prefix <PREFIX>] [--github-output] [--github-env] [--json <file>] [--region <region>]

Fetches CloudFormation stack outputs and prints them as KEY=value lines.
With --github-env / --github-output the values are appended to $GITHUB_ENV /
$GITHUB_OUTPUT as <PREFIX><OutputKey>. --outputs-file reads a file produced by
\`cdk deploy --outputs-file\` instead of calling CloudFormation.`;

export type StackOutputs = Record<string, Record<string, string>>;

export interface StackOutputsDeps {
  readonly describeStack: (stackName: string, region: string | undefined) => Promise<Output[]>;
}

export const defaultDeps: StackOutputsDeps = {
  describeStack: async (stackName, region) => {
    const client = new CloudFormationClient(region ? { region } : {});
    const response = await client.send(new DescribeStacksCommand({ StackName: stackName }));
    return response.Stacks?.[0]?.Outputs ?? [];
  },
};

const readOutputsFile = (file: string): StackOutputs => {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CliError(`${file} does not look like a cdk outputs file`);
  }
  const result: StackOutputs = {};
  for (const [stack, outputs] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof outputs !== "object" || outputs === null) continue;
    result[stack] = Object.fromEntries(
      Object.entries(outputs as Record<string, unknown>).map(([k, v]) => [
        k,
        typeof v === "string" ? v : JSON.stringify(v),
      ]),
    );
  }
  return result;
};

export const flattenOutputs = (outputs: StackOutputs, prefix = ""): Record<string, string> => {
  const flat: Record<string, string> = {};
  for (const stackOutputs of Object.values(outputs)) {
    for (const [key, value] of Object.entries(stackOutputs)) {
      flat[`${prefix}${key}`] = value;
    }
  }
  return flat;
};

export const stackOutputsCommand = async (
  argv: string[],
  io: Io,
  deps: StackOutputsDeps = defaultDeps,
): Promise<number> => {
  const { values } = parseArgs({
    args: argv,
    options: {
      stack: { type: "string", multiple: true },
      "outputs-file": { type: "string" },
      prefix: { type: "string", default: "" },
      "github-output": { type: "boolean", default: false },
      "github-env": { type: "boolean", default: false },
      json: { type: "string" },
      region: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });
  if (values.help) {
    io.out(STACK_OUTPUTS_HELP);
    return 0;
  }

  let outputs: StackOutputs;
  if (values["outputs-file"]) {
    outputs = readOutputsFile(values["outputs-file"]);
  } else if (values.stack && values.stack.length > 0) {
    outputs = {};
    const region = values.region ?? io.env["AWS_REGION"] ?? io.env["AWS_DEFAULT_REGION"];
    for (const stackName of values.stack) {
      const list = await deps.describeStack(stackName, region);
      outputs[stackName] = Object.fromEntries(
        list
          .filter((o) => o.OutputKey !== undefined)
          .map((o) => [o.OutputKey ?? "", o.OutputValue ?? ""]),
      );
    }
  } else {
    throw new CliError("either --stack <name> or --outputs-file <file> is required");
  }

  const flat = flattenOutputs(outputs, values.prefix);
  for (const [key, value] of Object.entries(flat)) {
    io.out(`${key}=${value}`);
  }
  if (values.json) {
    writeFileSync(values.json, `${JSON.stringify(outputs, null, 2)}\n`);
  }
  const githubEnv = io.env["GITHUB_ENV"];
  if (values["github-env"] && githubEnv) {
    for (const [key, value] of Object.entries(flat)) appendGitHubFile(githubEnv, key, value);
  }
  const githubOutput = io.env["GITHUB_OUTPUT"];
  if (values["github-output"] && githubOutput) {
    for (const [key, value] of Object.entries(flat))
      appendGitHubFile(githubOutput, key, value, { allowHyphen: true });
    appendGitHubFile(githubOutput, "outputs-json", JSON.stringify(outputs), { allowHyphen: true });
    appendGitHubFile(githubOutput, "stack-names", Object.keys(outputs).join(","), {
      allowHyphen: true,
    });
  }
  return 0;
};
