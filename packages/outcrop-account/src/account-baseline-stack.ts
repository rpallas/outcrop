import { type App, Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { AccountBaseline, type AccountBaselineModules } from "./account-baseline";
import type { AccountConfig } from "./config";
import { type AccountEnvContext, resolveAccountEnv } from "./context";
import { EdgeCertificate } from "./modules/dns";

export interface AccountBaselineStackProps extends Omit<StackProps, "env" | "stackName"> {
  readonly config: AccountConfig;
  /** Environment to deploy; defaults to `-c env=<name>`. */
  readonly env?: string;
  readonly modules: AccountBaselineModules;
  /** Override the default `PlatformAccount-<env>` stack name. */
  readonly stackName?: string;
}

/**
 * Stack wrapper around `AccountBaseline` that resolves the environment from
 * context, targets the configured account/region and names itself
 * `PlatformAccount-<env>`.
 */
export class AccountBaselineStack extends Stack {
  readonly context: AccountEnvContext;
  readonly baseline: AccountBaseline;

  constructor(scope: Construct, id: string, props: AccountBaselineStackProps) {
    const context = resolveAccountEnv(scope, props.config, props.env);
    const { config, env: _env, modules, stackName, ...stackProps } = props;
    super(scope, id, {
      ...stackProps,
      stackName: stackName ?? `PlatformAccount-${context.env}`,
      env: { account: context.environment.account, region: context.environment.region },
      description: stackProps.description ?? `${config.project} account baseline (${context.env})`,
      terminationProtection: stackProps.terminationProtection ?? context.environment.protected,
    });
    this.context = context;
    this.baseline = new AccountBaseline(this, "Baseline", { context, modules });
  }
}

export interface AccountEdgeStackProps extends Omit<StackProps, "env" | "stackName"> {
  /** The baseline stack whose hosted zone the certificate validates against. */
  readonly baseline: AccountBaselineStack;
  readonly stackName?: string;
}

/**
 * Companion stack in `us-east-1` holding the CloudFront certificate for the
 * environment domain. Created automatically by `createAccountBaseline` when the
 * DNS module is on and the home region is not `us-east-1`.
 */
export class AccountEdgeStack extends Stack {
  readonly certificate: EdgeCertificate;

  constructor(scope: Construct, id: string, props: AccountEdgeStackProps) {
    const { baseline, stackName, ...stackProps } = props;
    const dns = baseline.baseline.dns;
    if (!dns) throw new Error("AccountEdgeStack requires the dns module on the baseline stack");
    super(scope, id, {
      ...stackProps,
      stackName: stackName ?? `PlatformAccountEdge-${baseline.context.env}`,
      env: { account: baseline.context.environment.account, region: "us-east-1" },
      crossRegionReferences: true,
      description:
        stackProps.description ??
        `${baseline.context.config.project} us-east-1 certificate (${baseline.context.env})`,
    });
    this.certificate = new EdgeCertificate(this, "EdgeCertificate", {
      context: baseline.context,
      hostedZoneId: dns.hostedZone.hostedZoneId,
      domain: dns.domain,
      homeRegion: baseline.context.environment.region,
    });
    this.addStackDependency(baseline);
  }
}

export interface AccountBaselineStacks {
  readonly baseline: AccountBaselineStack;
  readonly edge?: AccountEdgeStack;
}

/**
 * Creates the baseline stack for the selected environment and, when DNS is
 * enabled outside `us-east-1`, the edge certificate stack alongside it.
 */
export const createAccountBaseline = (
  app: App,
  props: AccountBaselineStackProps,
): AccountBaselineStacks => {
  const baseline = new AccountBaselineStack(app, "AccountBaseline", {
    ...props,
    crossRegionReferences: true,
  });
  if (baseline.baseline.dns && baseline.context.environment.region !== "us-east-1") {
    return { baseline, edge: new AccountEdgeStack(app, "AccountEdge", { baseline }) };
  }
  return { baseline };
};
