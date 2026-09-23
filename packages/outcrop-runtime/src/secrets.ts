import {
  getSecret as powertoolsGetSecret,
  SecretsProvider,
} from "@aws-lambda-powertools/parameters/secrets";
import type { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { SSMClient } from "@aws-sdk/client-ssm";
import { DEFAULT_SSM_ROOT } from "./env";
import { getParameter, platformParams, type GetParameterOptions } from "./params";
import { PlatformParameterPaths } from "./paths";

/** Default cache duration for secrets, in seconds. */
export const DEFAULT_SECRET_MAX_AGE = 300;

export interface GetSecretOptions {
  /** Maximum age of the cached value in seconds (default 300). */
  maxAge?: number;
  /** Bypass the cache for this call. */
  forceFetch?: boolean;
  /** Custom Secrets Manager client, mainly for tests. */
  client?: SecretsManagerClient;
  /** Custom SSM client used to resolve `/{root}/secrets/{name}/arn`, mainly for tests. */
  ssmClient?: SSMClient;
  /** SSM root prefix used to resolve secret names; defaults to `PLATFORM_SSM_ROOT` or `/platform`. */
  rootPrefix?: string;
}

export interface GetSecretJsonOptions<T> extends GetSecretOptions {
  /** Validates / narrows the parsed JSON, e.g. `schema.parse` from zod. */
  parse?: (value: unknown) => T;
}

const providers = new WeakMap<SecretsManagerClient, SecretsProvider>();

const providerFor = (client: SecretsManagerClient | undefined): SecretsProvider | undefined => {
  if (!client) return undefined;
  let provider = providers.get(client);
  if (!provider) {
    provider = new SecretsProvider({ awsSdkV3Client: client });
    providers.set(client, provider);
  }
  return provider;
};

const isArn = (value: string): boolean => value.startsWith("arn:");

const defaultSsmRoot = (): string => {
  const value = process.env["PLATFORM_SSM_ROOT"];
  return value === undefined || value === "" ? DEFAULT_SSM_ROOT : value;
};

/**
 * Resolves the Secrets Manager ARN for a shared platform secret name via the
 * SSM contract path `/{root}/secrets/{name}/arn`. ARNs are returned unchanged.
 */
export async function resolveSecretArn(
  nameOrArn: string,
  options: GetSecretOptions = {},
): Promise<string> {
  if (isArn(nameOrArn)) return nameOrArn;
  const paths = new PlatformParameterPaths(options.rootPrefix ?? defaultSsmRoot());
  const parameterOptions: GetParameterOptions = {};
  if (options.maxAge !== undefined) parameterOptions.maxAge = options.maxAge;
  if (options.ssmClient !== undefined) parameterOptions.client = options.ssmClient;
  return getParameter(paths.secretArn(nameOrArn), parameterOptions);
}

/**
 * Reads a secret string from Secrets Manager, cached for `maxAge` seconds (default 300).
 *
 * `nameOrArn` may be a full ARN or the short name of a shared platform secret,
 * in which case the ARN is looked up from SSM first.
 */
export async function getSecret(
  nameOrArn: string,
  options: GetSecretOptions = {},
): Promise<string> {
  const arn = await resolveSecretArn(nameOrArn, options);
  const getOptions: { maxAge: number; forceFetch?: boolean } = {
    maxAge: options.maxAge ?? DEFAULT_SECRET_MAX_AGE,
  };
  if (options.forceFetch !== undefined) getOptions.forceFetch = options.forceFetch;

  const provider = providerFor(options.client);
  const value: string | Uint8Array | undefined = provider
    ? await provider.get(arn, getOptions)
    : await powertoolsGetSecret(arn, getOptions);

  if (value === undefined) {
    throw new Error(`Secret "${nameOrArn}" was not found`);
  }
  return typeof value === "string" ? value : Buffer.from(value).toString("utf8");
}

/**
 * Reads a JSON secret and optionally validates it with `parse`.
 *
 * @example
 * const creds = await getSecretJson("database", { parse: DbSchema.parse });
 */
export async function getSecretJson<T = unknown>(
  nameOrArn: string,
  options: GetSecretJsonOptions<T> = {},
): Promise<T> {
  const raw = await getSecret(nameOrArn, options);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Secret "${nameOrArn}" does not contain valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return options.parse ? options.parse(parsed) : (parsed as T);
}

export interface GetConfigOptions {
  /** Maximum age of the cached value in seconds (default 300). */
  maxAge?: number;
  /** SSM root prefix; defaults to `PLATFORM_SSM_ROOT` or `/platform`. */
  rootPrefix?: string;
  /** Custom SSM client, mainly for tests. */
  client?: SSMClient;
}

/** Reads the shared configuration value `/{root}/config/{key}`. */
export function getConfig(key: string, options: GetConfigOptions = {}): Promise<string> {
  return platformParams(options).config(key);
}
