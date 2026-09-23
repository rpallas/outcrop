import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { mockClient } from "aws-sdk-client-mock";
import {
  buildConnectionString,
  createHandler,
  NeonApi,
  NeonApiError,
  type NeonBranchEvent,
  type NeonBranchResourceProperties,
  type NeonConnectionSecret,
  parseApiKey,
  parsePhysicalId,
  pooledHost,
  requiresReplacement,
} from "../src/handlers/neon-branch";

const secretsMock = mockClient(SecretsManagerClient);

const API_KEY_ARN =
  "arn:aws:secretsmanager:eu-west-1:111111111111:secret:platform-dev-neon-api-key-AbCdEf";
const CONNECTION_ARN =
  "arn:aws:secretsmanager:eu-west-1:111111111111:secret:pr-42-orders-neon-connection-XyZ123";

const properties = (
  overrides: Partial<NeonBranchResourceProperties> = {},
): NeonBranchResourceProperties & { ServiceToken: string } => ({
  ServiceToken: "arn:aws:lambda:eu-west-1:111111111111:function:provider",
  projectId: "proud-lake-123456",
  parentBranch: "main",
  branchName: "pr-42-orders-db",
  database: "neondb",
  role: "neondb_owner",
  connectionSecretArn: CONNECTION_ARN,
  apiKeySecretArn: API_KEY_ARN,
  apiBaseUrl: "https://console.neon.tech/api/v2",
  pooled: "true",
  ...overrides,
});

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

/** Fake Neon API: records calls and answers from a routing table. */
const fakeFetch = (routes: Routes): { fetch: typeof fetch; calls: Call[] } => {
  const calls: Call[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const path = url.pathname.replace(/^\/api\/v2/, "");
    const method = init?.method ?? "GET";
    const call: Call = {
      method,
      path,
      ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) as unknown } : {}),
    };
    calls.push(call);
    const route = routes[`${method} ${path}`];
    if (!route) {
      return Promise.resolve(
        new Response(JSON.stringify({ message: `no route for ${method} ${path}` }), {
          status: 404,
        }),
      );
    }
    const { status = 200, body } = route(call);
    return Promise.resolve(
      new Response(body === undefined ? "" : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
};

const PROJECT = "/projects/proud-lake-123456";
const BRANCHES = `${PROJECT}/branches`;

type Routes = Record<string, (call: Call) => { status?: number; body?: unknown }>;

const mainBranch = { id: "br-main-000001", name: "main", default: true };
const newBranch = { id: "br-new-000002", name: "pr-42-orders-db" };
const endpoint = {
  id: "ep-cool-river-123456",
  host: "ep-cool-river-123456.eu-central-1.aws.neon.tech",
  type: "read_write",
};

const baseRoutes = (): Routes => ({
  [`GET ${BRANCHES}`]: () => ({ body: { branches: [mainBranch] } }),
  [`POST ${BRANCHES}`]: () => ({
    body: {
      branch: newBranch,
      endpoints: [endpoint],
      operations: [
        { id: "op-1", status: "running", action: "create_branch" },
        { id: "op-2", status: "finished", action: "start_compute" },
      ],
    },
  }),
  [`GET ${PROJECT}/operations/op-1`]: () => ({
    body: { operation: { id: "op-1", status: "finished" } },
  }),
  [`GET ${BRANCHES}/${newBranch.id}/roles/neondb_owner/reveal_password`]: () => ({
    body: { password: "s3cr3t/p@ss" },
  }),
  [`GET ${BRANCHES}/${newBranch.id}/endpoints`]: () => ({ body: { endpoints: [endpoint] } }),
  [`DELETE ${BRANCHES}/${newBranch.id}`]: () => ({
    body: { branch: newBranch, operations: [{ id: "op-9", status: "finished" }] },
  }),
});

const event = (
  type: NeonBranchEvent["RequestType"],
  extra: Partial<NeonBranchEvent> = {},
): NeonBranchEvent => ({
  RequestType: type,
  ResourceType: "Custom::NeonBranch",
  LogicalResourceId: "DbBranch",
  ResourceProperties: properties(),
  ...extra,
});

const noSleep = (): Promise<void> => Promise.resolve();

describe("pure helpers", () => {
  it("parses plain and JSON API keys", () => {
    expect(parseApiKey("  napi_abc  ")).toBe("napi_abc");
    expect(parseApiKey(JSON.stringify({ apiKey: "napi_json" }))).toBe("napi_json");
    expect(parseApiKey(JSON.stringify({ api_key: "napi_snake" }))).toBe("napi_snake");
    expect(() => parseApiKey(JSON.stringify({ other: 1 }))).toThrow(/apiKey/);
    expect(() => parseApiKey("   ")).toThrow(/empty/);
  });

  it("derives the pooler host", () => {
    expect(pooledHost("ep-cool-river-123456.eu-central-1.aws.neon.tech")).toBe(
      "ep-cool-river-123456-pooler.eu-central-1.aws.neon.tech",
    );
    expect(pooledHost("localhost")).toBe("localhost-pooler");
  });

  it("builds a connection string with an encoded password", () => {
    expect(
      buildConnectionString({
        host: "db.example.com",
        database: "neondb",
        user: "neondb_owner",
        password: "p@ss/word",
      }),
    ).toBe("postgresql://neondb_owner:p%40ss%2Fword@db.example.com:5432/neondb?sslmode=require");
  });

  it("parses physical ids", () => {
    expect(parsePhysicalId("proud-lake-123456/br-x-1")).toEqual({
      projectId: "proud-lake-123456",
      branchId: "br-x-1",
    });
    expect(parsePhysicalId("DbBranch-failed")).toBeUndefined();
    expect(parsePhysicalId(undefined)).toBeUndefined();
  });

  it("only replaces on project or name changes", () => {
    const next = properties();
    expect(requiresReplacement(next, undefined)).toBe(true);
    expect(requiresReplacement(next, properties())).toBe(false);
    expect(requiresReplacement(next, properties({ branchName: "other" }))).toBe(true);
    expect(requiresReplacement(next, properties({ projectId: "other" }))).toBe(true);
    expect(requiresReplacement(next, properties({ parentBranch: "staging" }))).toBe(false);
    expect(requiresReplacement(next, properties({ database: "other" }))).toBe(false);
  });
});

describe("NeonApi", () => {
  it("sends the bearer token and surfaces API errors with the status", async () => {
    const { fetch, calls } = fakeFetch({
      [`GET ${BRANCHES}`]: () => ({ status: 401, body: { message: "nope" } }),
    });
    const api = new NeonApi({
      apiKey: "napi_x",
      baseUrl: "https://console.neon.tech/api/v2/",
      fetch,
      sleep: noSleep,
    });
    await expect(api.listBranches("proud-lake-123456")).rejects.toBeInstanceOf(NeonApiError);
    expect(calls).toHaveLength(1);
  });

  it("gives up polling after maxPollAttempts", async () => {
    const { fetch } = fakeFetch({
      [`GET ${PROJECT}/operations/op-slow`]: () => ({
        body: { operation: { id: "op-slow", status: "running" } },
      }),
    });
    const api = new NeonApi({
      apiKey: "k",
      baseUrl: "https://console.neon.tech/api/v2",
      fetch,
      sleep: noSleep,
      maxPollAttempts: 3,
    });
    await expect(
      api.waitForOperations("proud-lake-123456", [{ id: "op-slow", status: "running" }]),
    ).rejects.toThrow(/did not finish after 3 polls/);
  });

  it("fails fast when an operation errors", async () => {
    const { fetch } = fakeFetch({});
    const api = new NeonApi({
      apiKey: "k",
      baseUrl: "https://console.neon.tech/api/v2",
      fetch,
      sleep: noSleep,
    });
    await expect(
      api.waitForOperations("proud-lake-123456", [
        { id: "op-bad", status: "failed", error: "boom" },
      ]),
    ).rejects.toThrow(/boom/);
  });

  it("falls back to reset_password when reveal is not allowed", async () => {
    const { fetch, calls } = fakeFetch({
      [`GET ${BRANCHES}/br-1/roles/app/reveal_password`]: () => ({ status: 403, body: {} }),
      [`POST ${BRANCHES}/br-1/roles/app/reset_password`]: () => ({
        body: { role: { password: "reset-pw" }, operations: [] },
      }),
    });
    const api = new NeonApi({
      apiKey: "k",
      baseUrl: "https://console.neon.tech/api/v2",
      fetch,
      sleep: noSleep,
    });
    await expect(api.rolePassword("proud-lake-123456", "br-1", "app")).resolves.toBe("reset-pw");
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
  });
});

describe("handler", () => {
  beforeEach(() => {
    secretsMock.reset();
    secretsMock.on(GetSecretValueCommand).resolves({ SecretString: "napi_test_key" });
    secretsMock.on(PutSecretValueCommand).resolves({});
  });

  it("creates a branch, waits for operations and writes the connection secret", async () => {
    const { fetch, calls } = fakeFetch(baseRoutes());
    const handler = createHandler({
      fetch,
      secretsManager: new SecretsManagerClient({}),
      sleep: noSleep,
    });

    const response = await handler(event("Create"));

    expect(response.PhysicalResourceId).toBe("proud-lake-123456/br-new-000002");
    expect(response.Data).toEqual({
      BranchId: "br-new-000002",
      EndpointId: endpoint.id,
      Host: endpoint.host,
      PooledHost: "ep-cool-river-123456-pooler.eu-central-1.aws.neon.tech",
    });
    // No credentials leak through Data
    expect(JSON.stringify(response.Data)).not.toContain("s3cr3t");

    const create = calls.find((c) => c.method === "POST" && c.path === BRANCHES);
    expect(create?.body).toEqual({
      branch: { name: "pr-42-orders-db", parent_id: "br-main-000001" },
      endpoints: [{ type: "read_write" }],
    });
    expect(calls.some((c) => c.path === `${PROJECT}/operations/op-1`)).toBe(true);

    expect(secretsMock.commandCalls(GetSecretValueCommand)[0]?.args[0].input).toEqual({
      SecretId: API_KEY_ARN,
    });
    const put = secretsMock.commandCalls(PutSecretValueCommand)[0]?.args[0].input;
    expect(put?.SecretId).toBe(CONNECTION_ARN);
    const secret = JSON.parse(put?.SecretString ?? "{}") as NeonConnectionSecret;
    expect(secret).toMatchObject({
      host: endpoint.host,
      pooledHost: "ep-cool-river-123456-pooler.eu-central-1.aws.neon.tech",
      port: 5432,
      database: "neondb",
      user: "neondb_owner",
      password: "s3cr3t/p@ss",
      branchId: "br-new-000002",
      projectId: "proud-lake-123456",
    });
    expect(secret.connectionString).toBe(secret.pooledConnectionString);
    expect(secret.directConnectionString).toContain(`@${endpoint.host}:5432/neondb`);
  });

  it("passes suspend timeout, accepts JSON API keys and prefers direct strings when pooled=false", async () => {
    secretsMock
      .on(GetSecretValueCommand)
      .resolves({ SecretString: JSON.stringify({ apiKey: "napi_json" }) });
    const { fetch, calls } = fakeFetch(baseRoutes());
    const handler = createHandler({
      fetch,
      secretsManager: new SecretsManagerClient({}),
      sleep: noSleep,
    });

    await handler(
      event("Create", {
        ResourceProperties: properties({ suspendTimeoutSeconds: "300", pooled: "false" }),
      }),
    );

    const create = calls.find((c) => c.method === "POST" && c.path === BRANCHES);
    expect(create?.body).toMatchObject({
      endpoints: [{ type: "read_write", suspend_timeout_seconds: 300 }],
    });
    const put = secretsMock.commandCalls(PutSecretValueCommand)[0]?.args[0].input;
    const secret = JSON.parse(put?.SecretString ?? "{}") as NeonConnectionSecret;
    expect(secret.connectionString).toBe(secret.directConnectionString);
  });

  it("adopts an existing branch with the same name instead of failing", async () => {
    const routes = baseRoutes();
    routes[`GET ${BRANCHES}`] = () => ({ body: { branches: [mainBranch, newBranch] } });
    const { fetch, calls } = fakeFetch(routes);
    const handler = createHandler({
      fetch,
      secretsManager: new SecretsManagerClient({}),
      sleep: noSleep,
    });

    const response = await handler(event("Create"));

    expect(response.PhysicalResourceId).toBe("proud-lake-123456/br-new-000002");
    expect(calls.some((c) => c.method === "POST" && c.path === BRANCHES)).toBe(false);
    expect(calls.some((c) => c.path === `${BRANCHES}/${newBranch.id}/endpoints`)).toBe(true);
  });

  it("fails when the parent branch does not exist", async () => {
    const { fetch } = fakeFetch(baseRoutes());
    const handler = createHandler({
      fetch,
      secretsManager: new SecretsManagerClient({}),
      sleep: noSleep,
    });
    await expect(
      handler(event("Create", { ResourceProperties: properties({ parentBranch: "missing" }) })),
    ).rejects.toThrow(/no branch named "missing"/);
    expect(secretsMock.commandCalls(PutSecretValueCommand)).toHaveLength(0);
  });

  it("refreshes the secret on Update without replacement", async () => {
    const { fetch, calls } = fakeFetch(baseRoutes());
    const handler = createHandler({
      fetch,
      secretsManager: new SecretsManagerClient({}),
      sleep: noSleep,
    });

    const response = await handler(
      event("Update", {
        PhysicalResourceId: "proud-lake-123456/br-new-000002",
        ResourceProperties: properties({ database: "orders" }),
        OldResourceProperties: properties(),
      }),
    );

    expect(response.PhysicalResourceId).toBe("proud-lake-123456/br-new-000002");
    expect(calls.some((c) => c.method === "POST" && c.path === BRANCHES)).toBe(false);
    const put = secretsMock.commandCalls(PutSecretValueCommand)[0]?.args[0].input;
    expect(JSON.parse(put?.SecretString ?? "{}")).toMatchObject({ database: "orders" });
  });

  it("creates a new branch and returns a new physical id when the name changes", async () => {
    const routes = baseRoutes();
    const renamed = { id: "br-renamed-000003", name: "renamed" };
    routes[`POST ${BRANCHES}`] = () => ({
      body: { branch: renamed, endpoints: [endpoint], operations: [] },
    });
    routes[`GET ${BRANCHES}/${renamed.id}/roles/neondb_owner/reveal_password`] = () => ({
      body: { password: "pw" },
    });
    const { fetch } = fakeFetch(routes);
    const handler = createHandler({
      fetch,
      secretsManager: new SecretsManagerClient({}),
      sleep: noSleep,
    });

    const response = await handler(
      event("Update", {
        PhysicalResourceId: "proud-lake-123456/br-new-000002",
        ResourceProperties: properties({ branchName: "renamed" }),
        OldResourceProperties: properties(),
      }),
    );

    expect(response.PhysicalResourceId).toBe("proud-lake-123456/br-renamed-000003");
  });

  it("deletes the branch on Delete and tolerates 404", async () => {
    const { fetch, calls } = fakeFetch(baseRoutes());
    const handler = createHandler({
      fetch,
      secretsManager: new SecretsManagerClient({}),
      sleep: noSleep,
    });

    await handler(event("Delete", { PhysicalResourceId: "proud-lake-123456/br-new-000002" }));
    expect(
      calls.some((c) => c.method === "DELETE" && c.path === `${BRANCHES}/${newBranch.id}`),
    ).toBe(true);

    const gone = fakeFetch({
      [`DELETE ${BRANCHES}/br-gone-1`]: () => ({ status: 404, body: { message: "not found" } }),
    });
    const handlerGone = createHandler({
      fetch: gone.fetch,
      secretsManager: new SecretsManagerClient({}),
      sleep: noSleep,
    });
    await expect(
      handlerGone(event("Delete", { PhysicalResourceId: "proud-lake-123456/br-gone-1" })),
    ).resolves.toEqual({ PhysicalResourceId: "proud-lake-123456/br-gone-1" });
  });

  it("skips Delete for a physical id that is not a branch (failed Create)", async () => {
    const { fetch, calls } = fakeFetch(baseRoutes());
    const handler = createHandler({
      fetch,
      secretsManager: new SecretsManagerClient({}),
      sleep: noSleep,
    });
    await handler(event("Delete", { PhysicalResourceId: "DbBranch-1234" }));
    expect(calls).toHaveLength(0);
    expect(secretsMock.commandCalls(GetSecretValueCommand)).toHaveLength(0);
  });

  it("propagates API errors so CloudFormation fails the resource", async () => {
    const routes = baseRoutes();
    routes[`POST ${BRANCHES}`] = () => ({ status: 500, body: { message: "boom" } });
    const { fetch } = fakeFetch(routes);
    const handler = createHandler({
      fetch,
      secretsManager: new SecretsManagerClient({}),
      sleep: noSleep,
    });
    await expect(handler(event("Create"))).rejects.toThrow(/failed with 500/);
  });
});
