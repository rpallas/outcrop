import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import type { CustomResourceEvent, CustomResourceResponse } from "@rpallas/outcrop";

/**
 * Properties the `NeonBranch` construct passes to the custom resource.
 * CloudFormation delivers every scalar as a string, so numbers are strings here.
 */
export interface NeonBranchResourceProperties extends Record<string, unknown> {
  readonly projectId: string;
  /** Parent branch name or id (`br-...`). */
  readonly parentBranch: string;
  readonly branchName: string;
  readonly database: string;
  readonly role: string;
  /** Secrets Manager ARN that receives the connection details. */
  readonly connectionSecretArn: string;
  /** Secrets Manager ARN holding the Neon API key. */
  readonly apiKeySecretArn: string;
  readonly apiBaseUrl: string;
  /** `"true"` when `connectionString` should use the pooler host. */
  readonly pooled?: string;
  readonly suspendTimeoutSeconds?: string;
}

/** Attributes returned to CloudFormation (`Fn::GetAtt`). Never contains credentials. */
export interface NeonBranchResourceData extends Record<string, unknown> {
  readonly BranchId: string;
  readonly EndpointId: string;
  readonly Host: string;
  readonly PooledHost: string;
}

/** JSON document written to the connection secret. */
export interface NeonConnectionSecret {
  readonly host: string;
  readonly pooledHost: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  /** Pooled or direct connection string depending on the construct's `pooled` option. */
  readonly connectionString: string;
  readonly directConnectionString: string;
  readonly pooledConnectionString: string;
  readonly branchId: string;
  readonly projectId: string;
}

export interface NeonBranchSummary {
  readonly id: string;
  readonly name: string;
  readonly default?: boolean;
  readonly primary?: boolean;
}

export interface NeonEndpoint {
  readonly id: string;
  readonly host: string;
  readonly type: string;
  readonly branch_id?: string;
}

export interface NeonOperation {
  readonly id: string;
  readonly status: string;
  readonly action?: string;
  readonly error?: string;
}

interface CreateBranchResponse {
  readonly branch: NeonBranchSummary;
  readonly endpoints?: NeonEndpoint[];
  readonly operations?: NeonOperation[];
}

const TERMINAL_OPERATION_STATES = new Set(["finished", "skipped"]);
const FAILED_OPERATION_STATES = new Set(["failed", "error", "cancelled"]);

export const NEON_DEFAULT_PORT = 5432;

/** Type of the global `fetch` so it can be injected in tests. */
export type FetchLike = typeof fetch;

/** Error raised for non-2xx Neon API responses; carries the HTTP status. */
export class NeonApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    body: string,
  ) {
    super(`Neon API ${method} ${path} failed with ${status}: ${body.slice(0, 500)}`);
    this.name = "NeonApiError";
  }
}

/**
 * The Neon API key secret may be a plain string or a JSON document with an
 * `apiKey` (or `api_key`) property.
 */
export const parseApiKey = (secretString: string): string => {
  const trimmed = secretString.trim();
  if (trimmed.startsWith("{")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const candidate = record["apiKey"] ?? record["api_key"];
      if (typeof candidate === "string" && candidate.length > 0) return candidate;
    }
    throw new Error("Neon API key secret is JSON but has no `apiKey` property");
  }
  if (trimmed.length === 0) throw new Error("Neon API key secret is empty");
  return trimmed;
};

/** Neon connection pooler host: the endpoint label gains a `-pooler` suffix. */
export const pooledHost = (host: string): string => {
  const dot = host.indexOf(".");
  if (dot === -1) return `${host}-pooler`;
  return `${host.slice(0, dot)}-pooler${host.slice(dot)}`;
};

export interface ConnectionStringParts {
  readonly host: string;
  readonly port?: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

/** `postgresql://user:password@host:5432/database?sslmode=require` with the password URL-encoded. */
export const buildConnectionString = (parts: ConnectionStringParts): string =>
  `postgresql://${encodeURIComponent(parts.user)}:${encodeURIComponent(parts.password)}@${parts.host}:${parts.port ?? NEON_DEFAULT_PORT}/${parts.database}?sslmode=require`;

/** Physical resource id of the custom resource: `projectId/branchId`. */
export const physicalId = (projectId: string, branchId: string): string =>
  `${projectId}/${branchId}`;

export const parsePhysicalId = (
  value: string | undefined,
): { projectId: string; branchId: string } | undefined => {
  if (!value) return undefined;
  const [projectId, branchId, ...rest] = value.split("/");
  if (!projectId || !branchId || rest.length > 0 || !branchId.startsWith("br-")) return undefined;
  return { projectId, branchId };
};

export interface NeonApiOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch?: FetchLike;
  /** Sleep between operation polls; injectable for tests. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly pollIntervalMs?: number;
  readonly maxPollAttempts?: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Minimal Neon API v2 client covering what the branch lifecycle needs. */
export class NeonApi {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;

  constructor(options: NeonApiOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.maxPollAttempts = options.maxPollAttempts ?? 90;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.apiKey}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    if (!response.ok) throw new NeonApiError(response.status, method, path, text);
    return (text.length > 0 ? JSON.parse(text) : {}) as T;
  }

  async listBranches(projectId: string): Promise<NeonBranchSummary[]> {
    const result = await this.request<{ branches?: NeonBranchSummary[] }>(
      "GET",
      `/projects/${encodeURIComponent(projectId)}/branches`,
    );
    return result.branches ?? [];
  }

  /** Resolve a branch id from a name or id; the default branch is used for `main` when no branch has that name. */
  async resolveBranchId(projectId: string, nameOrId: string): Promise<string> {
    if (nameOrId.startsWith("br-")) return nameOrId;
    const branches = await this.listBranches(projectId);
    const byName = branches.find((branch) => branch.name === nameOrId);
    if (byName) return byName.id;
    if (nameOrId === "main") {
      const fallback = branches.find((branch) => branch.default ?? branch.primary);
      if (fallback) return fallback.id;
    }
    throw new Error(`Neon project ${projectId} has no branch named "${nameOrId}"`);
  }

  async findBranchByName(projectId: string, name: string): Promise<NeonBranchSummary | undefined> {
    const branches = await this.listBranches(projectId);
    return branches.find((branch) => branch.name === name);
  }

  async createBranch(
    projectId: string,
    input: { name: string; parentId: string; suspendTimeoutSeconds?: number },
  ): Promise<CreateBranchResponse> {
    const result = await this.request<CreateBranchResponse>(
      "POST",
      `/projects/${encodeURIComponent(projectId)}/branches`,
      {
        branch: { name: input.name, parent_id: input.parentId },
        endpoints: [
          {
            type: "read_write",
            ...(input.suspendTimeoutSeconds !== undefined
              ? { suspend_timeout_seconds: input.suspendTimeoutSeconds }
              : {}),
          },
        ],
      },
    );
    await this.waitForOperations(projectId, result.operations);
    return result;
  }

  async listEndpoints(projectId: string, branchId: string): Promise<NeonEndpoint[]> {
    const result = await this.request<{ endpoints?: NeonEndpoint[] }>(
      "GET",
      `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/endpoints`,
    );
    return result.endpoints ?? [];
  }

  /** Read the role password, resetting it when the project does not allow revealing passwords. */
  async rolePassword(projectId: string, branchId: string, role: string): Promise<string> {
    const base = `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/roles/${encodeURIComponent(role)}`;
    try {
      const revealed = await this.request<{ password?: string }>("GET", `${base}/reveal_password`);
      if (revealed.password) return revealed.password;
    } catch (error) {
      if (!(error instanceof NeonApiError) || error.status < 400 || error.status >= 500)
        throw error;
    }
    const reset = await this.request<{
      role?: { password?: string };
      operations?: NeonOperation[];
    }>("POST", `${base}/reset_password`);
    await this.waitForOperations(projectId, reset.operations);
    if (!reset.role?.password) {
      throw new Error(`Neon did not return a password for role "${role}" on branch ${branchId}`);
    }
    return reset.role.password;
  }

  /** Delete a branch; a 404 means it is already gone. */
  async deleteBranch(projectId: string, branchId: string): Promise<boolean> {
    try {
      const result = await this.request<{ operations?: NeonOperation[] }>(
        "DELETE",
        `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}`,
      );
      await this.waitForOperations(projectId, result.operations);
      return true;
    } catch (error) {
      if (error instanceof NeonApiError && error.status === 404) return false;
      throw error;
    }
  }

  async getOperation(projectId: string, operationId: string): Promise<NeonOperation> {
    const result = await this.request<{ operation: NeonOperation }>(
      "GET",
      `/projects/${encodeURIComponent(projectId)}/operations/${encodeURIComponent(operationId)}`,
    );
    return result.operation;
  }

  /** Poll until every operation is finished; bounded by `maxPollAttempts`. */
  async waitForOperations(
    projectId: string,
    operations: NeonOperation[] | undefined,
  ): Promise<void> {
    for (const operation of operations ?? []) {
      let current = operation;
      let attempts = 0;
      while (!TERMINAL_OPERATION_STATES.has(current.status)) {
        if (FAILED_OPERATION_STATES.has(current.status)) {
          throw new Error(
            `Neon operation ${current.id} (${current.action ?? "unknown"}) ${current.status}: ${current.error ?? "no details"}`,
          );
        }
        if (attempts >= this.maxPollAttempts) {
          throw new Error(
            `Neon operation ${current.id} (${current.action ?? "unknown"}) did not finish after ${attempts} polls`,
          );
        }
        attempts += 1;
        await this.sleep(this.pollIntervalMs);
        current = await this.getOperation(projectId, current.id);
      }
    }
  }
}

export interface HandlerDependencies {
  readonly fetch?: FetchLike;
  readonly secretsManager?: SecretsManagerClient;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly pollIntervalMs?: number;
  readonly maxPollAttempts?: number;
}

export type NeonBranchEvent = CustomResourceEvent<NeonBranchResourceProperties>;
export type NeonBranchResponse = CustomResourceResponse<NeonBranchResourceData>;

const parseSuspendTimeout = (value: string | undefined): number | undefined => {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * True when the properties that identify the branch changed and a new branch is
 * required. A branch's parent is immutable in Neon, so a changed `parentBranch`
 * only takes effect together with a new `branchName`.
 */
export const requiresReplacement = (
  next: NeonBranchResourceProperties,
  previous: NeonBranchResourceProperties | undefined,
): boolean => previous?.projectId !== next.projectId || previous.branchName !== next.branchName;

/** Build the Lambda handler with injectable AWS SDK client, `fetch` and sleep. */
export const createHandler = (
  deps: HandlerDependencies = {},
): ((event: NeonBranchEvent) => Promise<NeonBranchResponse>) => {
  const secretsManager = deps.secretsManager ?? new SecretsManagerClient({});

  const readApiKey = async (secretArn: string): Promise<string> => {
    const result = await secretsManager.send(new GetSecretValueCommand({ SecretId: secretArn }));
    if (!result.SecretString) throw new Error(`Secret ${secretArn} has no string value`);
    return parseApiKey(result.SecretString);
  };

  const apiFor = async (props: NeonBranchResourceProperties): Promise<NeonApi> =>
    new NeonApi({
      apiKey: await readApiKey(props.apiKeySecretArn),
      baseUrl: props.apiBaseUrl,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      ...(deps.pollIntervalMs !== undefined ? { pollIntervalMs: deps.pollIntervalMs } : {}),
      ...(deps.maxPollAttempts !== undefined ? { maxPollAttempts: deps.maxPollAttempts } : {}),
    });

  const writeConnectionSecret = async (
    api: NeonApi,
    props: NeonBranchResourceProperties,
    branchId: string,
    endpoint: NeonEndpoint,
  ): Promise<NeonBranchResourceData> => {
    const password = await api.rolePassword(props.projectId, branchId, props.role);
    const pooled = pooledHost(endpoint.host);
    const parts = { database: props.database, user: props.role, password };
    const directConnectionString = buildConnectionString({ host: endpoint.host, ...parts });
    const pooledConnectionString = buildConnectionString({ host: pooled, ...parts });
    const secret: NeonConnectionSecret = {
      host: endpoint.host,
      pooledHost: pooled,
      port: NEON_DEFAULT_PORT,
      database: props.database,
      user: props.role,
      password,
      connectionString: props.pooled === "false" ? directConnectionString : pooledConnectionString,
      directConnectionString,
      pooledConnectionString,
      branchId,
      projectId: props.projectId,
    };
    await secretsManager.send(
      new PutSecretValueCommand({
        SecretId: props.connectionSecretArn,
        SecretString: JSON.stringify(secret),
      }),
    );
    return { BranchId: branchId, EndpointId: endpoint.id, Host: endpoint.host, PooledHost: pooled };
  };

  const readWriteEndpoint = async (
    api: NeonApi,
    projectId: string,
    branchId: string,
    known: NeonEndpoint[] | undefined,
  ): Promise<NeonEndpoint> => {
    const candidates =
      known && known.length > 0 ? known : await api.listEndpoints(projectId, branchId);
    const endpoint = candidates.find((e) => e.type === "read_write") ?? candidates[0];
    if (!endpoint) throw new Error(`Neon branch ${branchId} has no endpoint`);
    return endpoint;
  };

  const create = async (props: NeonBranchResourceProperties): Promise<NeonBranchResponse> => {
    const api = await apiFor(props);
    const parentId = await api.resolveBranchId(props.projectId, props.parentBranch);
    const existing = await api.findBranchByName(props.projectId, props.branchName);
    let branchId: string;
    let endpoints: NeonEndpoint[] | undefined;
    if (existing) {
      // Idempotent re-create (for example a retried Create after a timeout): adopt the branch.
      branchId = existing.id;
    } else {
      const suspendTimeoutSeconds = parseSuspendTimeout(props.suspendTimeoutSeconds);
      const created = await api.createBranch(props.projectId, {
        name: props.branchName,
        parentId,
        ...(suspendTimeoutSeconds !== undefined ? { suspendTimeoutSeconds } : {}),
      });
      branchId = created.branch.id;
      endpoints = created.endpoints;
    }
    const endpoint = await readWriteEndpoint(api, props.projectId, branchId, endpoints);
    const data = await writeConnectionSecret(api, props, branchId, endpoint);
    return { PhysicalResourceId: physicalId(props.projectId, branchId), Data: data };
  };

  const update = async (event: NeonBranchEvent): Promise<NeonBranchResponse> => {
    const props = event.ResourceProperties;
    if (requiresReplacement(props, event.OldResourceProperties)) {
      // New physical id: CloudFormation sends a Delete for the previous branch afterwards.
      return create(props);
    }
    const current = parsePhysicalId(event.PhysicalResourceId);
    if (!current) return create(props);
    if (
      event.OldResourceProperties &&
      props.parentBranch !== event.OldResourceProperties.parentBranch
    ) {
      console.warn(
        `Neon branch ${current.branchId}: parentBranch changed but a branch's parent is immutable; rename the branch to re-create it from the new parent`,
      );
    }
    const api = await apiFor(props);
    const endpoint = await readWriteEndpoint(api, current.projectId, current.branchId, undefined);
    const data = await writeConnectionSecret(api, props, current.branchId, endpoint);
    return { PhysicalResourceId: physicalId(current.projectId, current.branchId), Data: data };
  };

  const remove = async (event: NeonBranchEvent): Promise<NeonBranchResponse> => {
    const current = parsePhysicalId(event.PhysicalResourceId);
    const response: NeonBranchResponse =
      event.PhysicalResourceId !== undefined
        ? { PhysicalResourceId: event.PhysicalResourceId }
        : {};
    if (!current) {
      // A failed Create never produced a branch; nothing to clean up.
      return response;
    }
    const api = await apiFor(event.ResourceProperties);
    const deleted = await api.deleteBranch(current.projectId, current.branchId);
    if (!deleted) console.warn(`Neon branch ${current.branchId} was already deleted`);
    return response;
  };

  return async (event: NeonBranchEvent): Promise<NeonBranchResponse> => {
    switch (event.RequestType) {
      case "Create":
        return create(event.ResourceProperties);
      case "Update":
        return update(event);
      case "Delete":
        return remove(event);
    }
  };
};

/** Lambda entry point. */
export const handler = createHandler();
