import { toPascalCase } from "./template";

export const SERVICE_VARIANTS = [
  "http-api",
  "queue-consumer",
  "event-subscriber",
  "scheduled",
  "static-site",
  "dynamodb",
  "neon",
] as const;
export type ServiceVariant = (typeof SERVICE_VARIANTS)[number];

export const AUTH_MODES = ["none", "jwt-auth0", "jwt-cognito", "api-key"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export interface ServiceStackSpec {
  readonly service: string;
  readonly variants: ReadonlySet<ServiceVariant>;
  readonly auth: AuthMode;
}

const line = (indent: number, text: string): string => `${" ".repeat(indent)}${text}`;

/**
 * Generates `infra/lib/service-stack.ts` for the selected variants. Kept as
 * code (not a template) so the combinations stay consistent and type-safe.
 */
export const renderServiceStack = (spec: ServiceStackSpec): string => {
  const has = (v: ServiceVariant): boolean => spec.variants.has(v);
  const className = `${toPascalCase(spec.service)}Stack`;

  const cdkImports = new Set<string>();
  const platformImports = new Set<string>([
    "PlatformStack",
    "type PlatformStackProps",
    "lambdaEntry",
    "PlatformFunction",
  ]);
  const otherImports: string[] = [];
  const body: string[] = [];
  const handlerEnv: string[] = [];
  const grants: string[] = [];

  if (has("dynamodb")) {
    cdkImports.add('import { AttributeType } from "aws-cdk-lib/aws-dynamodb";');
    platformImports.add("PlatformTable");
    body.push(
      line(4, "// Single-table design: pk/sk plus a GSI for lookups by secondary key."),
      line(4, 'const table = new PlatformTable(this, "Table", {'),
      line(6, 'partitionKey: { name: "pk", type: AttributeType.STRING },'),
      line(6, 'sortKey: { name: "sk", type: AttributeType.STRING },'),
      line(6, 'timeToLiveAttribute: "ttl",'),
      line(4, "});"),
      line(
        4,
        'table.addGsi({ partitionKey: { name: "gsi1pk", type: AttributeType.STRING }, sortKey: { name: "gsi1sk", type: AttributeType.STRING } });',
      ),
      line(4, "table.alarms.throttles();"),
      line(4, "this.table = table;"),
      "",
    );
    handlerEnv.push("TABLE_NAME: table.tableName");
    grants.push("table.grantReadWriteData(FN);");
  }

  if (has("neon")) {
    otherImports.push('import { NeonBranch } from "@rpallas/platform-cdk-neon";');
    body.push(
      line(4, "// Neon Postgres branch per preview; the base environment uses the primary branch."),
      line(4, 'const database = new NeonBranch(this, "Database", {'),
      line(6, 'apiKeySecretName: "neon-api-key",'),
      line(6, 'projectId: this.params.config("neon-project-id"),'),
      line(4, "});"),
      line(4, "this.database = database;"),
      "",
    );
    handlerEnv.push("DATABASE_SECRET_ARN: database.connectionSecret.secretArn");
    grants.push("database.connectionSecret.grantRead(FN);");
  }

  if (has("queue-consumer")) {
    cdkImports.add('import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";');
    cdkImports.add('import { Duration } from "aws-cdk-lib";');
    platformImports.add("PlatformQueue");
    body.push(
      line(
        4,
        'const jobs = new PlatformQueue(this, "Jobs", { deadLetterQueue: true, visibilityTimeout: Duration.seconds(90) });',
      ),
      line(4, "jobs.alarms.dlqDepth();"),
      line(4, "jobs.alarms.age();"),
      line(4, "this.jobs = jobs;"),
      "",
    );
  }

  if (has("http-api")) {
    cdkImports.add('import { HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";');
    platformImports.add("PlatformHttpApi");
    if (spec.auth !== "none") platformImports.add("PlatformHttpAuthorizers");
    if (spec.auth === "jwt-cognito") {
      platformImports.add("PlatformUserPool");
      body.push(
        line(
          4,
          "// Cognito user pool with a hosted UI client; tokens from it authorise API requests.",
        ),
        line(4, 'const userPool = new PlatformUserPool(this, "Users", { selfSignUp: false });'),
        line(4, "this.userPool = userPool;"),
        "",
      );
    }
    body.push(
      line(4, 'const httpHandler = new PlatformFunction(this, "HttpHandler", {'),
      line(
        6,
        'entry: lambdaEntry(path.join(__dirname, "..", "..", "app", "src", "handlers", "http")),',
      ),
      ...(handlerEnv.length > 0 ? [line(6, `environment: { ${handlerEnv.join(", ")} },`)] : []),
      line(4, "});"),
      ...grants.map((g) => line(4, g.replace("FN", "httpHandler"))),
      line(4, "httpHandler.addStandardAlarms();"),
      "",
      line(4, 'const api = new PlatformHttpApi(this, "Api", {'),
      line(6, "cors: true,"),
      ...authorizerLines(spec.auth),
      line(4, "});"),
      line(4, 'api.addLambdaRoute("/health", HttpMethod.GET, httpHandler{{HEALTH_AUTH}});'),
      line(4, 'api.addLambdaRoute("/items", [HttpMethod.GET, HttpMethod.POST], httpHandler);'),
      line(
        4,
        'api.addLambdaRoute("/items/{id}", [HttpMethod.GET, HttpMethod.DELETE], httpHandler);',
      ),
      line(4, "api.alarms.serverErrors();"),
      line(4, "api.alarms.latency();"),
      line(4, "this.api = api;"),
      "",
    );
    if (spec.auth === "api-key") {
      platformImports.add("PlatformSecret");
      body.unshift(
        line(
          4,
          "// API key stored in Secrets Manager; the Lambda authorizer compares request headers against it.",
        ),
        line(
          4,
          'const apiKey = new PlatformSecret(this, "ApiKey", { name: "api-key", generate: { length: 40 } });',
        ),
        line(4, 'const authorizerFn = new PlatformFunction(this, "Authorizer", {'),
        line(
          6,
          'entry: lambdaEntry(path.join(__dirname, "..", "..", "app", "src", "handlers", "authorizer")),',
        ),
        line(6, "environment: { API_KEY_SECRET_ARN: apiKey.secretArn },"),
        line(4, "});"),
        line(4, "apiKey.grantRead(authorizerFn);"),
        "",
      );
    }
  }

  if (has("queue-consumer")) {
    body.push(
      line(4, 'const consumer = new PlatformFunction(this, "Consumer", {'),
      line(
        6,
        'entry: lambdaEntry(path.join(__dirname, "..", "..", "app", "src", "handlers", "consumer")),',
      ),
      line(6, "timeout: Duration.seconds(60),"),
      ...(handlerEnv.length > 0 ? [line(6, `environment: { ${handlerEnv.join(", ")} },`)] : []),
      line(4, "});"),
      line(
        4,
        "consumer.addEventSource(new SqsEventSource(jobs, { batchSize: 10, reportBatchItemFailures: true }));",
      ),
      ...grants.map((g) => line(4, g.replace("FN", "consumer"))),
      line(4, "consumer.alarms.errors();"),
      "",
    );
    if (has("http-api")) {
      body.push(
        line(4, "jobs.grantSendMessages(httpHandler);"),
        line(4, 'httpHandler.addEnvironment("QUEUE_URL", jobs.queueUrl);'),
        "",
      );
    }
  }

  if (has("event-subscriber")) {
    platformImports.add("PlatformEventRule");
    body.push(
      line(4, 'const subscriber = new PlatformFunction(this, "Subscriber", {'),
      line(
        6,
        'entry: lambdaEntry(path.join(__dirname, "..", "..", "app", "src", "handlers", "subscriber")),',
      ),
      ...(handlerEnv.length > 0 ? [line(6, `environment: { ${handlerEnv.join(", ")} },`)] : []),
      line(4, "});"),
      ...grants.map((g) => line(4, g.replace("FN", "subscriber"))),
      line(4, "subscriber.alarms.errors();"),
      line(
        4,
        "// Subscribe to events on the platform event bus. Adjust the event names to your domain.",
      ),
      line(4, 'new PlatformEventRule(this, "OnExampleEvents", {'),
      line(6, 'eventNames: ["example.created", "example.updated"],'),
      line(6, "targets: [subscriber],"),
      line(4, "});"),
      "",
    );
  }

  if (has("scheduled")) {
    platformImports.add("PlatformSchedule");
    body.push(
      line(4, 'const job = new PlatformFunction(this, "ScheduledJob", {'),
      line(
        6,
        'entry: lambdaEntry(path.join(__dirname, "..", "..", "app", "src", "handlers", "scheduled")),',
      ),
      line(6, "timeout: Duration.minutes(5),"),
      ...(handlerEnv.length > 0 ? [line(6, `environment: { ${handlerEnv.join(", ")} },`)] : []),
      line(4, "});"),
      ...grants.map((g) => line(4, g.replace("FN", "job"))),
      line(4, "job.alarms.errors();"),
      line(
        4,
        'new PlatformSchedule(this, "Nightly", { schedule: "cron(0 2 * * ? *)", target: job });',
      ),
      "",
    );
    cdkImports.add('import { Duration } from "aws-cdk-lib";');
  }

  if (has("static-site")) {
    platformImports.add("PlatformStaticSite");
    body.push(
      line(
        4,
        "// Static site served through CloudFront on the service hostname" +
          (has("http-api") ? ", with /api routed to the HTTP API." : "."),
      ),
      line(4, 'const site = new PlatformStaticSite(this, "Site", {'),
      line(6, 'sourcePath: path.join(__dirname, "..", "..", "web", "dist"),'),
      ...(has("http-api") ? [line(6, 'apiOrigin: { api, pathPattern: "/api/*" },')] : []),
      line(4, "});"),
      line(4, "this.site = site;"),
      "",
    );
  }

  const fields: string[] = [];
  if (has("dynamodb")) fields.push("  readonly table: PlatformTable;");
  if (has("neon")) fields.push("  readonly database: NeonBranch;");
  if (has("queue-consumer")) fields.push("  readonly jobs: PlatformQueue;");
  if (has("http-api")) fields.push("  readonly api: PlatformHttpApi;");
  if (has("http-api") && spec.auth === "jwt-cognito")
    fields.push("  readonly userPool: PlatformUserPool;");
  if (has("static-site")) fields.push("  readonly site: PlatformStaticSite;");

  const healthAuth = spec.auth === "none" ? "" : ", { authorizer: PlatformHttpAuthorizers.none() }";
  const platformImportList = [...platformImports].sort((a, b) =>
    a.replace("type ", "").localeCompare(b.replace("type ", "")),
  );

  const out = [
    'import path from "node:path";',
    ...[...cdkImports].sort(),
    `import { ${platformImportList.join(", ")} } from "@rpallas/platform-cdk";`,
    ...otherImports,
    'import type { Construct } from "constructs";',
    "",
    `export class ${className} extends PlatformStack {`,
    ...fields,
    ...(fields.length > 0 ? [""] : []),
    "  constructor(scope: Construct, id: string, props?: PlatformStackProps) {",
    "    super(scope, id, props);",
    "",
    ...body,
    "  }",
    "}",
    "",
  ];
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n\n {2}\}\n\}/, "\n  }\n}")
    .replace("{{HEALTH_AUTH}}", healthAuth);
};

const authorizerLines = (auth: AuthMode): string[] => {
  switch (auth) {
    case "none":
      return [];
    case "jwt-auth0":
      return [
        line(
          6,
          "// Auth0 tenant domain and API audience come from the shared platform config parameters.",
        ),
        line(
          6,
          'defaultAuthorizer: PlatformHttpAuthorizers.auth0(this.params.lookup(this.params.paths.config("auth0-domain"), { defaultValue: "example.eu.auth0.com" }), this.params.lookup(this.params.paths.config("auth0-audience"), { defaultValue: "https://api.example.com" })),',
        ),
      ];
    case "jwt-cognito":
      return [
        line(
          6,
          "// Cognito user pool created in this stack (see PlatformUserPool below or import an existing one).",
        ),
        line(6, "defaultAuthorizer: PlatformHttpAuthorizers.cognito(userPool),"),
      ];
    case "api-key":
      return [line(6, "defaultAuthorizer: PlatformHttpAuthorizers.lambda(authorizerFn),")];
  }
};
