import { parseArgs } from "node:util";
import { type Io, CliError, appendGitHubFile } from "../io";
import { derivePreviewId, PREVIEW_ID_STRATEGIES, type PreviewIdStrategy } from "../preview-id";

export const PREVIEW_ID_HELP = `Usage: platform-cdk preview-id [--branch <name>] [--pr <number>] [--strategy ticket-then-pr|pr|branch-slug] [--github-output [name]]

Derives the preview id for a pull request. Defaults read GitHub Actions
environment variables (GITHUB_HEAD_REF / GITHUB_REF_NAME and the pull request
number from GITHUB_REF when it looks like refs/pull/<n>/merge).`;

const prNumberFromEnv = (env: NodeJS.ProcessEnv): string | undefined => {
  const explicit = env["PR_NUMBER"] ?? env["GITHUB_PR_NUMBER"];
  if (explicit) return explicit;
  const match = /^refs\/pull\/(\d+)\//.exec(env["GITHUB_REF"] ?? "");
  return match?.[1];
};

export const previewIdCommand = (argv: string[], io: Io): number => {
  const { values } = parseArgs({
    args: argv,
    options: {
      branch: { type: "string" },
      pr: { type: "string" },
      strategy: { type: "string", default: "ticket-then-pr" },
      "github-output": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });
  if (values.help) {
    io.out(PREVIEW_ID_HELP);
    return 0;
  }
  const strategy = values.strategy as PreviewIdStrategy;
  if (!PREVIEW_ID_STRATEGIES.includes(strategy)) {
    throw new CliError(
      `unknown strategy "${values.strategy}"; expected one of ${PREVIEW_ID_STRATEGIES.join(", ")}`,
    );
  }
  const branch = values.branch ?? io.env["GITHUB_HEAD_REF"] ?? io.env["GITHUB_REF_NAME"];
  const prNumber = values.pr ?? prNumberFromEnv(io.env);
  const id = derivePreviewId({ branch, prNumber }, strategy);
  io.out(id);

  const githubOutput = io.env["GITHUB_OUTPUT"];
  if (values["github-output"] !== undefined && githubOutput) {
    appendGitHubFile(githubOutput, values["github-output"] || "preview-id", id);
  }
  return 0;
};
