import {
  getParameter as powertoolsGetParameter,
  getParameters as powertoolsGetParameters,
  SSMProvider,
} from "@aws-lambda-powertools/parameters/ssm";
import type { SSMClient } from "@aws-sdk/client-ssm";
import { DEFAULT_SSM_ROOT, requireEnv } from "./env";
import { PlatformParameterPaths, type AlertSeverity } from "./paths";

/** Default cache duration for parameters, in seconds. */
export const DEFAULT_PARAMETER_MAX_AGE = 300;

export interface GetParameterOptions {
  /** Maximum age of the cached value in seconds (default 300). */
  maxAge?: number;
  /** Decrypt `SecureString` parameters (default false). */
  decrypt?: boolean;
  /** Bypass the cache for this call. */
  forceFetch?: boolean;
  /** Custom SSM client, mainly for tests. */
  client?: SSMClient;
}

export interface GetParametersOptions extends GetParameterOptions {
  /** Fetch parameters below the prefix recursively (default true). */
  recursive?: boolean;
}

const providers = new WeakMap<SSMClient, SSMProvider>();

/** Returns a cached `SSMProvider` bound to the given client, or `undefined` to use the default. */
const providerFor = (client: SSMClient | undefined): SSMProvider | undefined => {
  if (!client) return undefined;
  let provider = providers.get(client);
  if (!provider) {
    provider = new SSMProvider({ awsSdkV3Client: client });
    providers.set(client, provider);
  }
  return provider;
};

interface ResolvedGetOptions {
  maxAge: number;
  decrypt: boolean;
  forceFetch?: boolean;
}

const resolveGetOptions = (options: GetParameterOptions): ResolvedGetOptions => {
  const resolved: ResolvedGetOptions = {
    maxAge: options.maxAge ?? DEFAULT_PARAMETER_MAX_AGE,
    decrypt: options.decrypt ?? false,
  };
  if (options.forceFetch !== undefined) resolved.forceFetch = options.forceFetch;
  return resolved;
};

/**
 * Reads a single SSM parameter, cached for `maxAge` seconds (default 300).
 * Throws a descriptive error when the parameter does not exist.
 */
export async function getParameter(
  name: string,
  options: GetParameterOptions = {},
): Promise<string> {
  const getOptions = resolveGetOptions(options);
  const provider = providerFor(options.client);
  const value: string | undefined = provider
    ? await provider.get(name, getOptions)
    : await powertoolsGetParameter(name, getOptions);
  if (value === undefined) {
    throw new Error(`SSM parameter "${name}" was not found`);
  }
  return value;
}

/**
 * Reads all parameters below `prefix`, keyed by the path relative to the prefix.
 */
export async function getParameters(
  prefix: string,
  options: GetParametersOptions = {},
): Promise<Record<string, string>> {
  const getOptions = { ...resolveGetOptions(options), recursive: options.recursive ?? true };
  const provider = providerFor(options.client);
  const values: Record<string, string | undefined> | undefined = provider
    ? await provider.getMultiple(prefix, getOptions)
    : await powertoolsGetParameters(prefix, getOptions);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

export interface PlatformParamsOptions {
  /** SSM root prefix; defaults to `PLATFORM_SSM_ROOT` or `/platform`. */
  rootPrefix?: string;
  /** Environment name used by `env()`; defaults to `PLATFORM_ENV`. */
  env?: string;
  /** Cache duration in seconds for every read (default 300). */
  maxAge?: number;
  /** Custom SSM client, mainly for tests. */
  client?: SSMClient;
}

export interface PlatformAccountParams {
  id(): Promise<string>;
  name(): Promise<string>;
  kmsKeyArn(): Promise<string>;
  kmsKeyId(): Promise<string>;
  vpcId(): Promise<string>;
  logRetentionDays(): Promise<string>;
  accessLogsBucketName(): Promise<string>;
  cloudTrailBucketName(): Promise<string>;
  oidcProviderArn(): Promise<string>;
  deployRoleArn(repo: string): Promise<string>;
  readonlyRoleArn(repo: string): Promise<string>;
}

export interface PlatformEnvironmentParams {
  name(): Promise<string>;
  domain(): Promise<string>;
  dnsZoneId(): Promise<string>;
  dnsZoneName(): Promise<string>;
  certRegionalArn(): Promise<string>;
  certUsEast1Arn(): Promise<string>;
  alertTopicArn(severity: AlertSeverity): Promise<string>;
  eventBusName(): Promise<string>;
  eventBusArn(): Promise<string>;
}

export interface PlatformParams {
  /** Path builder used by the getters. */
  paths: PlatformParameterPaths;
  /** Reads an arbitrary parameter path. */
  get(path: string, options?: GetParameterOptions): Promise<string>;
  /** Account-level contract values. */
  account: PlatformAccountParams;
  /** Environment-level contract values; `envName` defaults to `PLATFORM_ENV`. */
  env(envName?: string): PlatformEnvironmentParams;
  /** Shared plain configuration value `/{root}/config/{key}`. */
  config(key: string): Promise<string>;
  /** ARN of the shared secret `/{root}/secrets/{name}/arn`. */
  secretArn(name: string): Promise<string>;
  /** Value published by another service `/{root}/services/{service}/{key}`. */
  service(service: string, key: string): Promise<string>;
}

const defaultRootPrefix = (): string => {
  const value = process.env["PLATFORM_SSM_ROOT"];
  return value === undefined || value === "" ? DEFAULT_SSM_ROOT : value;
};

/**
 * Typed accessors for the platform SSM contract.
 *
 * @example
 * const params = platformParams();
 * const busName = await params.env().eventBusName();
 */
export function platformParams(options: PlatformParamsOptions = {}): PlatformParams {
  const paths = new PlatformParameterPaths(options.rootPrefix ?? defaultRootPrefix());
  const baseOptions: GetParameterOptions = {};
  if (options.maxAge !== undefined) baseOptions.maxAge = options.maxAge;
  if (options.client !== undefined) baseOptions.client = options.client;

  const get = (path: string, overrides: GetParameterOptions = {}): Promise<string> =>
    getParameter(path, { ...baseOptions, ...overrides });

  const account: PlatformAccountParams = {
    id: () => get(paths.account.id()),
    name: () => get(paths.account.name()),
    kmsKeyArn: () => get(paths.account.kmsKeyArn()),
    kmsKeyId: () => get(paths.account.kmsKeyId()),
    vpcId: () => get(paths.account.vpcId()),
    logRetentionDays: () => get(paths.account.logRetentionDays()),
    accessLogsBucketName: () => get(paths.account.accessLogsBucketName()),
    cloudTrailBucketName: () => get(paths.account.cloudTrailBucketName()),
    oidcProviderArn: () => get(paths.account.oidcProviderArn()),
    deployRoleArn: (repo) => get(paths.account.deployRoleArn(repo)),
    readonlyRoleArn: (repo) => get(paths.account.readonlyRoleArn(repo)),
  };

  const env = (envName?: string): PlatformEnvironmentParams => {
    const resolved = envName ?? options.env ?? requireEnv("PLATFORM_ENV");
    const envPaths = paths.env(resolved);
    return {
      name: () => get(envPaths.name()),
      domain: () => get(envPaths.domain()),
      dnsZoneId: () => get(envPaths.dnsZoneId()),
      dnsZoneName: () => get(envPaths.dnsZoneName()),
      certRegionalArn: () => get(envPaths.certRegionalArn()),
      certUsEast1Arn: () => get(envPaths.certUsEast1Arn()),
      alertTopicArn: (severity) => get(envPaths.alertTopicArn(severity)),
      eventBusName: () => get(envPaths.eventBusName()),
      eventBusArn: () => get(envPaths.eventBusArn()),
    };
  };

  return {
    paths,
    get,
    account,
    env,
    config: (key) => get(paths.config(key)),
    secretArn: (name) => get(paths.secretArn(name)),
    service: (service, key) => get(paths.service(service, key)),
  };
}
