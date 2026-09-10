import { readFileSync } from "node:fs";
import path from "node:path";
import { createServiceCommand, CREATE_SERVICE_HELP } from "./commands/create-service";
import { previewIdCommand, PREVIEW_ID_HELP } from "./commands/preview-id";
import { stackOutputsCommand, STACK_OUTPUTS_HELP } from "./commands/stack-outputs";
import { CliError, type Io, processIo } from "./io";

export * from "./preview-id";
export * from "./scaffold/template";
export * from "./scaffold/service-stack";
export { CliError } from "./io";
export { derivePreviewId as previewId } from "./preview-id";

export const HELP = `platform-cdk - scaffolding and CI helpers for platform-cdk services

Usage: platform-cdk <command> [options]

Commands:
  create service <name>   Scaffold a new service (see: platform-cdk create service --help)
  create account <name>   Scaffold an account baseline app
  preview-id              Derive the preview id for a pull request
  stack-outputs           Print / export CloudFormation stack outputs
  sync-skills             Copy the bundled agent skills into ./.agents/skills
  help                    Show this help

Run any command with --help for details.`;

type CommandHandler = (argv: string[], io: Io) => Promise<number> | number;

const lazy = (load: () => Promise<CommandHandler>): CommandHandler => {
  return async (argv, io) => (await load())(argv, io);
};

const COMMANDS: Record<string, CommandHandler> = {
  "preview-id": previewIdCommand,
  "stack-outputs": stackOutputsCommand,
  "create:service": createServiceCommand,
  "create:account": lazy(
    async () => (await import("./commands/create-account")).createAccountCommand,
  ),
  "sync-skills": lazy(async () => (await import("./commands/sync-skills")).syncSkillsCommand),
};

export const HELP_TEXT: Record<string, string> = {
  "preview-id": PREVIEW_ID_HELP,
  "stack-outputs": STACK_OUTPUTS_HELP,
  "create:service": CREATE_SERVICE_HELP,
};

export const main = async (argv: string[], io: Io = processIo): Promise<number> => {
  const [first, ...rest] = argv;
  if (!first || first === "help" || first === "--help" || first === "-h") {
    io.out(HELP);
    return 0;
  }
  if (first === "--version" || first === "-v") {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as {
      version: string;
    };
    io.out(pkg.version);
    return 0;
  }

  let key = first;
  let args = rest;
  if (first === "create") {
    const [sub, ...subRest] = rest;
    if (!sub || sub === "--help" || sub === "-h") {
      io.out("Usage: platform-cdk create <service|account> <name> [options]");
      return sub ? 0 : 1;
    }
    key = `create:${sub}`;
    args = subRest;
  }

  const handler = COMMANDS[key];
  if (!handler) {
    io.err(`Unknown command "${argv.join(" ")}".\n\n${HELP}`);
    return 1;
  }

  try {
    return await handler(args, io);
  } catch (error) {
    if (error instanceof CliError) {
      io.err(error.message);
      return error.exitCode;
    }
    throw error;
  }
};
