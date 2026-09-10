import { getSecretJson, requireEnv } from "@rpallas/platform-cdk-runtime";

/** Connection details written by `NeonBranch` into Secrets Manager. */
export interface NeonConnection {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  connectionString: string;
  pooledConnectionString: string;
  branchId?: string;
}

/**
 * Reads the Neon connection secret for this stack (a dedicated branch in
 * previews, the shared connection in base environments). Cached for five
 * minutes by the runtime. Pair it with your Postgres client of choice, e.g.
 * `new Pool({ connectionString: (await getDatabaseConnection()).pooledConnectionString })`.
 */
export const getDatabaseConnection = (): Promise<NeonConnection> =>
  getSecretJson<NeonConnection>(requireEnv("DATABASE_SECRET_ARN"));
