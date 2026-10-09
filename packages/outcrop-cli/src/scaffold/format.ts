import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Io } from "../io";

/**
 * Formats the scaffolded files with the project's own (just installed) prettier and config.
 * Rendered templates only match the formatter once their placeholders are substituted.
 */
export const formatWithProjectPrettier = (files: readonly string[], cwd: string): void => {
  if (files.length === 0) return;
  execFileSync(
    "npx",
    [
      "--no-install",
      "prettier",
      "--write",
      "--ignore-unknown",
      "--log-level",
      "warn",
      ...files.map((file) => path.relative(cwd, file)),
    ],
    { cwd, stdio: "inherit" },
  );
};

/** Runs `format` on the written files; a formatting failure is reported but does not fail the scaffold. */
export const formatScaffold = (
  files: readonly string[],
  cwd: string,
  io: Io,
  format: ((files: readonly string[], cwd: string) => void) | undefined,
): void => {
  if (!format) return;
  try {
    format(files, cwd);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.err(`warning: could not format the generated files (${message}); run \`npm run lint:fix\`.`);
  }
};
