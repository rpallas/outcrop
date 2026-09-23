import type { Io } from "../src/io";

export interface CapturedIo extends Io {
  readonly stdout: string[];
  readonly stderr: string[];
}

export const capture = (env: NodeJS.ProcessEnv = {}): CapturedIo => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: (line) => {
      stdout.push(line);
    },
    err: (line) => {
      stderr.push(line);
    },
    env,
  };
};
