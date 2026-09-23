import { Stack, Tags } from "aws-cdk-lib";
import { PLATFORM_TAGS } from "@rpallas/outcrop";
import { Construct } from "constructs";
import type { AccountEnvContext } from "./context";
import { AccountSettings, type AccountSettingsProps } from "./modules/account-settings";
import { Alerting, type AlertingProps } from "./modules/alerting";
import { output, publishParameter } from "./modules/base";
import { Budgets, type BudgetsProps } from "./modules/budgets";
import { Dns, type DnsProps } from "./modules/dns";
import { Encryption, type EncryptionProps } from "./modules/encryption";
import { EventBusModule, type EventBusModuleProps } from "./modules/event-bus";
import { GitHubOidc, type GitHubOidcProps } from "./modules/github-oidc";
import { LogRetention, type LogRetentionProps } from "./modules/log-retention";
import { Network, type NetworkProps } from "./modules/network";
import { Security, type SecurityProps } from "./modules/security";
import {
  SharedParameters,
  type SharedParametersProps,
  SharedSecrets,
  type SharedSecretsProps,
} from "./modules/shared";

type ModuleProps<T> = Omit<T, "context">;
/** `true` enables a module with defaults, an object enables it with options, `false`/undefined leaves it off. */
type ModuleOption<T> = boolean | ModuleProps<T>;

export interface AccountBaselineModules {
  readonly githubOidc?: ModuleOption<GitHubOidcProps>;
  readonly accountSettings?: ModuleOption<AccountSettingsProps>;
  readonly dns?: ModuleOption<DnsProps>;
  readonly alerting?: ModuleOption<AlertingProps>;
  readonly eventBus?: ModuleOption<EventBusModuleProps>;
  readonly encryption?: ModuleOption<EncryptionProps>;
  readonly sharedParameters?: ModuleProps<SharedParametersProps>;
  readonly sharedSecrets?: ModuleProps<SharedSecretsProps>;
  readonly budgets?: ModuleOption<BudgetsProps>;
  readonly security?: ModuleOption<SecurityProps>;
  readonly network?: ModuleOption<NetworkProps>;
  readonly logRetention?: ModuleOption<LogRetentionProps>;
}

export interface AccountBaselineProps {
  readonly context: AccountEnvContext;
  /** Modules to deploy. Everything not listed is off. */
  readonly modules: AccountBaselineModules;
}

const enabled = <T>(option: ModuleOption<T> | undefined): ModuleProps<T> | undefined => {
  if (option === undefined || option === false) return undefined;
  return option === true ? ({} as ModuleProps<T>) : option;
};

/**
 * Composes the opt-in account modules and wires them together: the KMS key
 * encrypts topics, secrets and audit logs; alert topics receive budget
 * notifications; every module publishes to the SSM contract (ADR 0003).
 * Each module is also usable standalone.
 */
export class AccountBaseline extends Construct {
  readonly context: AccountEnvContext;
  readonly encryption?: Encryption;
  readonly githubOidc?: GitHubOidc;
  readonly accountSettings?: AccountSettings;
  readonly dns?: Dns;
  readonly alerting?: Alerting;
  readonly eventBus?: EventBusModule;
  readonly sharedParameters?: SharedParameters;
  readonly sharedSecrets?: SharedSecrets;
  readonly budgets?: Budgets;
  readonly security?: Security;
  readonly network?: Network;
  readonly logRetention?: LogRetention;

  constructor(scope: Construct, id: string, props: AccountBaselineProps) {
    super(scope, id);
    const { context, modules } = props;
    this.context = context;
    const stack = Stack.of(this);

    Tags.of(this).add(PLATFORM_TAGS.project, context.config.project);
    Tags.of(this).add(PLATFORM_TAGS.service, "platform");
    Tags.of(this).add(PLATFORM_TAGS.env, context.env);
    Tags.of(this).add(PLATFORM_TAGS.managedBy, "outcrop");
    for (const [key, value] of Object.entries(context.config.tags)) Tags.of(this).add(key, value);

    publishParameter(this, "AccountIdParam", context.paths.account.id(), stack.account);
    publishParameter(
      this,
      "AccountNameParam",
      context.paths.account.name(),
      `${context.config.project}-${context.env}`,
    );
    publishParameter(this, "EnvNameParam", context.paths.env(context.env).name(), context.env);

    const encryption = enabled(modules.encryption);
    if (encryption)
      this.encryption = new Encryption(this, "Encryption", { context, ...encryption });
    const kmsKey = this.encryption?.key;

    const githubOidc = enabled(modules.githubOidc);
    if (githubOidc)
      this.githubOidc = new GitHubOidc(this, "GitHubOidc", { context, ...githubOidc });

    const accountSettings = enabled(modules.accountSettings);
    if (accountSettings)
      this.accountSettings = new AccountSettings(this, "AccountSettings", {
        context,
        ...accountSettings,
      });

    const dns = enabled(modules.dns);
    if (dns) this.dns = new Dns(this, "Dns", { context, ...dns });

    const alerting = enabled(modules.alerting);
    if (alerting)
      this.alerting = new Alerting(this, "Alerting", {
        context,
        ...(kmsKey ? { kmsKey } : {}),
        ...alerting,
      });

    const eventBus = enabled(modules.eventBus);
    if (eventBus) this.eventBus = new EventBusModule(this, "EventBus", { context, ...eventBus });

    if (modules.sharedParameters)
      this.sharedParameters = new SharedParameters(this, "SharedParameters", {
        context,
        ...modules.sharedParameters,
      });
    if (modules.sharedSecrets)
      this.sharedSecrets = new SharedSecrets(this, "SharedSecrets", {
        context,
        ...(kmsKey ? { kmsKey } : {}),
        ...modules.sharedSecrets,
      });

    const budgets = enabled(modules.budgets);
    if (budgets) {
      const topic = this.alerting?.topic("high");
      this.budgets = new Budgets(this, "Budgets", {
        context,
        ...(topic ? { topic } : {}),
        ...budgets,
      });
    }

    const security = enabled(modules.security);
    if (security)
      this.security = new Security(this, "Security", {
        context,
        ...(kmsKey ? { kmsKey } : {}),
        ...security,
      });

    const network = enabled(modules.network);
    if (network) this.network = new Network(this, "Network", { context, ...network });

    const logRetention = enabled(modules.logRetention);
    if (logRetention)
      this.logRetention = new LogRetention(this, "LogRetention", { context, ...logRetention });

    output(this, "Environment", context.env);
    output(this, "SsmRootPrefix", context.config.ssmRootPrefix);
  }
}
