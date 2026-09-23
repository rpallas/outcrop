import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { CliError, type Io } from "../io";
import { copyTemplateDir, type CopyResult, templatesRoot } from "../scaffold/files";
import { type TemplateVars, toPascalCase } from "../scaffold/template";

export const CREATE_ACCOUNT_HELP = `Usage: outcrop create account <name> [options]

Scaffolds an account baseline CDK app using @rpallas/outcrop-account.

Options:
  --project <name>      Project name (default: name)
  --domain <domain>     Apex domain, e.g. example.com (default example.com)
  --region <region>     AWS region (default eu-west-1)
  --owner <github-owner> GitHub owner allowed to deploy (default my-org)
  --dev-account <id>    Dev account id (default 111111111111)
  --prod-account <id>   Prod account id (default 222222222222)
  --dir <path>          Target directory (default ./<name>)
  --no-install          Skip npm install
  --force               Overwrite existing files
  --dry-run             Print what would be written`;

const NAME_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/;
const ACCOUNT_RE = /^\d{12}$/;

const DEV_DEPS = [
  "@rpallas/outcrop-account",
  "@rpallas/outcrop",
  "aws-cdk-lib",
  "constructs",
  "aws-cdk",
  "typescript",
  "ts-node",
  "jest",
  "ts-jest",
  "@types/jest",
  "@types/node",
  "prettier",
];

export interface CreateAccountOptions {
  readonly name: string;
  readonly project: string;
  readonly domain: string;
  readonly region: string;
  readonly owner: string;
  readonly devAccount: string;
  readonly prodAccount: string;
  readonly targetDir: string;
  readonly install: boolean;
  readonly force: boolean;
  readonly dryRun: boolean;
  readonly platformVersion: string;
}

export const parseCreateAccountArgs = (
  argv: string[],
  cwd: string,
): CreateAccountOptions | "help" => {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      project: { type: "string" },
      domain: { type: "string", default: "example.com" },
      region: { type: "string", default: "eu-west-1" },
      owner: { type: "string", default: "my-org" },
      "dev-account": { type: "string", default: "111111111111" },
      "prod-account": { type: "string", default: "222222222222" },
      dir: { type: "string" },
      install: { type: "boolean", default: true },
      "no-install": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "platform-version": { type: "string", default: "latest" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });
  if (values.help) return "help";
  const name = positionals[0];
  if (!name) throw new CliError(`missing name\n\n${CREATE_ACCOUNT_HELP}`);
  if (!NAME_RE.test(name)) throw new CliError(`name "${name}" must be lowercase kebab-case`);
  for (const [flag, value] of [
    ["--dev-account", values["dev-account"]],
    ["--prod-account", values["prod-account"]],
  ] as const) {
    if (!ACCOUNT_RE.test(value)) throw new CliError(`${flag} must be a 12 digit AWS account id`);
  }
  return {
    name,
    project: values.project ?? name,
    domain: values.domain,
    region: values.region,
    owner: values.owner,
    devAccount: values["dev-account"],
    prodAccount: values["prod-account"],
    targetDir: path.resolve(cwd, values.dir ?? name),
    install: values.install && !values["no-install"],
    force: values.force,
    dryRun: values["dry-run"],
    platformVersion: values["platform-version"],
  };
};

export const accountTemplateVars = (options: CreateAccountOptions): TemplateVars => ({
  name: options.name,
  Name: toPascalCase(options.name),
  project: options.project,
  domain: options.domain,
  region: options.region,
  owner: options.owner,
  devAccount: options.devAccount,
  prodAccount: options.prodAccount,
});

export interface AccountScaffoldDeps {
  readonly npmInstall: (args: string[], cwd: string) => void;
}

const defaultDeps: AccountScaffoldDeps = {
  npmInstall: (args, cwd) => {
    execFileSync("npm", ["install", "--no-audit", "--no-fund", ...args], { cwd, stdio: "inherit" });
  },
};

export const scaffoldAccount = (
  options: CreateAccountOptions,
  io: Io,
  deps: AccountScaffoldDeps = defaultDeps,
): CopyResult => {
  const result = copyTemplateDir(
    path.join(templatesRoot(), "account"),
    options.targetDir,
    accountTemplateVars(options),
    {
      force: options.force,
      dryRun: options.dryRun,
    },
  );
  if (!options.dryRun) {
    const specs = DEV_DEPS.map((d) =>
      d.startsWith("@rpallas/") ? `${d}@${options.platformVersion}` : `${d}@latest`,
    );
    if (options.install) {
      io.out("Installing dependencies...");
      deps.npmInstall(["--save-dev", ...specs], options.targetDir);
    } else {
      const pkgPath = path.join(options.targetDir, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
      pkg["devDependencies"] = Object.fromEntries(
        DEV_DEPS.map((d) => [d, d.startsWith("@rpallas/") ? options.platformVersion : "latest"]),
      );
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    }
  }
  return result;
};

export const createAccountCommand = (
  argv: string[],
  io: Io,
  deps: AccountScaffoldDeps = defaultDeps,
): number => {
  const options = parseCreateAccountArgs(argv, process.cwd());
  if (options === "help") {
    io.out(CREATE_ACCOUNT_HELP);
    return 0;
  }
  const result = scaffoldAccount(options, io, deps);
  const rel = (file: string): string => path.relative(process.cwd(), file);
  for (const file of result.written)
    io.out(`${options.dryRun ? "would write" : "created"}  ${rel(file)}`);
  for (const file of result.skipped)
    io.out(`skipped  ${rel(file)} (exists; use --force to overwrite)`);
  if (!options.dryRun) {
    io.out("");
    io.out(`Account baseline "${options.name}" created in ${rel(options.targetDir)}.`);
    io.out("Next steps:");
    io.out(`  cd ${rel(options.targetDir)}`);
    io.out("  Edit account.config.ts (account ids, domain, GitHub repositories).");
    io.out(`  npx cdk bootstrap aws://${options.devAccount}/${options.region}`);
    io.out("  npx cdk deploy --all -c env=dev");
  }
  return 0;
};
