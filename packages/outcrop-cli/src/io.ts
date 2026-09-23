import { appendFileSync } from "node:fs";

/** Minimal output abstraction so commands are testable. */
export interface Io {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly env: NodeJS.ProcessEnv;
}

export const processIo: Io = {
  out: (line) => {
    process.stdout.write(`${line}\n`);
  },
  err: (line) => {
    process.stderr.write(`${line}\n`);
  },
  env: process.env,
};

/** Step output names may contain hyphens; environment variable names may not. */
const sanitiseKey = (key: string, allowHyphen: boolean): string =>
  key.replace(allowHyphen ? /[^A-Za-z0-9_-]/g : /[^A-Za-z0-9_]/g, "_");

/** Append `key=value` (multi-line safe) to a GitHub Actions file such as $GITHUB_OUTPUT or $GITHUB_ENV. */
export const appendGitHubFile = (
  file: string,
  key: string,
  value: string,
  options: { allowHyphen?: boolean } = {},
): void => {
  const safeKey = sanitiseKey(key, options.allowHyphen ?? false);
  if (value.includes("\n")) {
    const delimiter = `EOF_${Math.random().toString(36).slice(2, 10)}`;
    appendFileSync(file, `${safeKey}<<${delimiter}\n${value}\n${delimiter}\n`);
  } else {
    appendFileSync(file, `${safeKey}=${value}\n`);
  }
};

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}
