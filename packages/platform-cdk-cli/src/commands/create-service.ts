import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { CliError, type Io } from "../io";
import { copyTemplateDir, type CopyResult, templatesRoot, writeFile } from "../scaffold/files";
import {
  AUTH_MODES,
  type AuthMode,
  renderServiceStack,
  SERVICE_VARIANTS,
  type ServiceVariant,
} from "../scaffold/service-stack";
import { type TemplateVars, toPascalCase } from "../scaffold/template";

export const CREATE_SERVICE_HELP = `Usage: platform-cdk create service <name> [options]

Scaffolds a new service repository using platform-cdk.

Variants (combine freely):
  --http-api            HTTP API + Lambda handler with /health and /items routes
  --queue-consumer      SQS queue with dead letter queue and a consumer Lambda
  --event-subscriber    EventBridge rule on the platform bus with a subscriber Lambda
  --scheduled           Scheduled Lambda job
  --static-site         CloudFront + S3 static site (with /api origin when --http-api)
  --dynamodb            DynamoDB table (single-table design) wired into handlers
  --neon                Neon Postgres branch per preview

Options:
  --auth <mode>         none | jwt-auth0 | jwt-cognito | api-key (default none, requires --http-api)
  --project <name>      Project name for tags (default: name)
  --domain <domain>     Apex domain, e.g. example.com (default example.com)
  --region <region>     AWS region (default eu-west-1)
  --owner <github-owner> GitHub owner (default my-org)
  --repo <github-repo>  GitHub repo (default: name)
  --dir <path>          Target directory (default ./<name>)
  --no-install          Skip npm install
  --force               Overwrite existing files
  --dry-run             Print what would be written`;

export interface CreateServiceOptions {
  readonly name: string;
  readonly variants: ReadonlySet<ServiceVariant>;
  readonly auth: AuthMode;
  readonly project: string;
  readonly domain: string;
  readonly region: string;
  readonly owner: string;
  readonly repo: string;
  readonly targetDir: string;
  readonly install: boolean;
  readonly force: boolean;
  readonly dryRun: boolean;
  /** Version spec for @rpallas packages, e.g. `latest` or `1.2.3`. */
  readonly platformVersion: string;
}

const SERVICE_NAME_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/;

const RUNTIME_DEPS = ["@rpallas/platform-cdk-runtime"];
const INFRA_DEPS = [
  "@rpallas/platform-cdk",
  "aws-cdk-lib",
  "constructs",
  "aws-cdk",
  "esbuild",
  "typescript",
  "ts-node",
  "jest",
  "ts-jest",
  "@types/jest",
  "@types/node",
  "@types/aws-lambda",
  "eslint",
  "@eslint/js",
  "typescript-eslint",
  "eslint-config-prettier",
  "prettier",
  "aws-sdk-client-mock",
];

export const dependenciesFor = (
  options: CreateServiceOptions,
): { dependencies: string[]; devDependencies: string[] } => {
  const dependencies = [...RUNTIME_DEPS];
  const devDependencies = [...INFRA_DEPS];
  if (options.variants.has("dynamodb"))
    dependencies.push("@aws-sdk/client-dynamodb", "@aws-sdk/lib-dynamodb");
  if (options.variants.has("neon")) devDependencies.push("@rpallas/platform-cdk-neon");
  if (options.auth === "api-key") dependencies.push("@aws-sdk/client-secrets-manager");
  return { dependencies, devDependencies };
};

const withVersion = (pkg: string, platformVersion: string): string =>
  pkg.startsWith("@rpallas/") ? `${pkg}@${platformVersion}` : `${pkg}@latest`;

export const templateVars = (options: CreateServiceOptions): TemplateVars => {
  const vars: TemplateVars = {
    service: options.name,
    Service: toPascalCase(options.name),
    project: options.project,
    domain: options.domain,
    region: options.region,
    owner: options.owner,
    repo: options.repo,
    auth: options.auth,
    variantList: [...options.variants].join(", ") || "none",
  };
  for (const variant of SERVICE_VARIANTS) {
    vars[`has${toPascalCase(variant)}`] = options.variants.has(variant);
  }
  vars["hasAuth"] = options.auth !== "none";
  vars[`auth${toPascalCase(options.auth)}`] = true;
  return vars;
};

export const parseCreateServiceArgs = (
  argv: string[],
  cwd: string,
): CreateServiceOptions | "help" => {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      "http-api": { type: "boolean", default: false },
      "queue-consumer": { type: "boolean", default: false },
      "event-subscriber": { type: "boolean", default: false },
      scheduled: { type: "boolean", default: false },
      "static-site": { type: "boolean", default: false },
      dynamodb: { type: "boolean", default: false },
      neon: { type: "boolean", default: false },
      auth: { type: "string", default: "none" },
      project: { type: "string" },
      domain: { type: "string", default: "example.com" },
      region: { type: "string", default: "eu-west-1" },
      owner: { type: "string", default: "my-org" },
      repo: { type: "string" },
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
  if (!name) throw new CliError(`missing service name\n\n${CREATE_SERVICE_HELP}`);
  if (!SERVICE_NAME_RE.test(name))
    throw new CliError(`service name "${name}" must be lowercase kebab-case`);

  const variants = new Set<ServiceVariant>(SERVICE_VARIANTS.filter((v) => values[v]));
  if (variants.size === 0) variants.add("http-api");
  if (variants.has("dynamodb") && variants.has("neon"))
    throw new CliError("choose either --dynamodb or --neon, not both");

  const auth = values.auth as AuthMode;
  if (!AUTH_MODES.includes(auth))
    throw new CliError(`unknown --auth "${values.auth}"; expected ${AUTH_MODES.join(" | ")}`);
  if (auth !== "none" && !variants.has("http-api"))
    throw new CliError("--auth requires --http-api");

  return {
    name,
    variants,
    auth,
    project: values.project ?? name,
    domain: values.domain,
    region: values.region,
    owner: values.owner,
    repo: values.repo ?? name,
    targetDir: path.resolve(cwd, values.dir ?? name),
    install: values.install && !values["no-install"],
    force: values.force,
    dryRun: values["dry-run"],
    platformVersion: values["platform-version"],
  };
};

export interface ScaffoldDeps {
  readonly npmInstall: (args: string[], cwd: string) => void;
}

export const defaultScaffoldDeps: ScaffoldDeps = {
  npmInstall: (args, cwd) => {
    execFileSync("npm", ["install", "--no-audit", "--no-fund", ...args], { cwd, stdio: "inherit" });
  },
};

/** Render the service into `options.targetDir`. */
export const scaffoldService = (
  options: CreateServiceOptions,
  io: Io,
  deps: ScaffoldDeps = defaultScaffoldDeps,
): CopyResult => {
  const root = path.join(templatesRoot(), "service");
  const vars = templateVars(options);
  const copyOptions = { force: options.force, dryRun: options.dryRun };
  const result: CopyResult = { written: [], skipped: [] };

  copyTemplateDir(path.join(root, "base"), options.targetDir, vars, copyOptions, result);
  for (const variant of options.variants) {
    const dir = path.join(root, "variants", variant);
    if (existsSync(dir)) copyTemplateDir(dir, options.targetDir, vars, copyOptions, result);
  }
  if (options.auth !== "none") {
    const dir = path.join(root, "variants", `auth-${options.auth}`);
    if (existsSync(dir)) copyTemplateDir(dir, options.targetDir, vars, copyOptions, result);
  }

  writeFile(
    path.join(options.targetDir, "infra", "lib", "service-stack.ts"),
    renderServiceStack({ service: options.name, variants: options.variants, auth: options.auth }),
    copyOptions,
    result,
  );

  const { dependencies, devDependencies } = dependenciesFor(options);
  if (!options.dryRun) {
    if (options.install) {
      io.out("Installing dependencies...");
      deps.npmInstall(
        dependencies.map((d) => withVersion(d, options.platformVersion)),
        options.targetDir,
      );
      deps.npmInstall(
        ["--save-dev", ...devDependencies.map((d) => withVersion(d, options.platformVersion))],
        options.targetDir,
      );
    } else {
      // Record the dependency names so `npm install` can resolve them later.
      const pkgPath = path.join(options.targetDir, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
      pkg["dependencies"] = Object.fromEntries(
        dependencies.map((d) => [
          d,
          d.startsWith("@rpallas/") ? options.platformVersion : "latest",
        ]),
      );
      pkg["devDependencies"] = Object.fromEntries(
        devDependencies.map((d) => [
          d,
          d.startsWith("@rpallas/") ? options.platformVersion : "latest",
        ]),
      );
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    }
  }

  return result;
};

export const createServiceCommand = (
  argv: string[],
  io: Io,
  deps: ScaffoldDeps = defaultScaffoldDeps,
): number => {
  const options = parseCreateServiceArgs(argv, process.cwd());
  if (options === "help") {
    io.out(CREATE_SERVICE_HELP);
    return 0;
  }
  const result = scaffoldService(options, io, deps);
  const rel = (file: string): string => path.relative(process.cwd(), file);
  for (const file of result.written)
    io.out(`${options.dryRun ? "would write" : "created"}  ${rel(file)}`);
  for (const file of result.skipped)
    io.out(`skipped  ${rel(file)} (exists; use --force to overwrite)`);
  if (!options.dryRun) {
    io.out("");
    io.out(`Service "${options.name}" created in ${rel(options.targetDir)}.`);
    io.out("Next steps:");
    io.out(`  cd ${rel(options.targetDir)}`);
    if (!options.install) io.out("  npm install");
    io.out("  npm run lint && npm test && npm run synth");
    io.out(
      "  Set repository variables AWS_REGION and AWS_DEPLOY_ROLE_ARN_DEV, then open a pull request.",
    );
  }
  return 0;
};
