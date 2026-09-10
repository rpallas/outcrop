import { type RemovalPolicy, Stack, type StackProps, Tags } from "aws-cdk-lib";
import type { RetentionDays } from "aws-cdk-lib/aws-logs";
import type { ITopic } from "aws-cdk-lib/aws-sns";
import type { Construct, IConstruct } from "constructs";
import type { AlertSeverity } from "../alerting/severity";
import { type PlatformContext, resolvePlatformContext } from "../config/context";
import type { PlatformConfig } from "../config/schema";
import type { PlatformNaming } from "../naming/naming";
import { PlatformParameters } from "../params/parameters";
import { createNaming, PlatformApp } from "./platform-app";

export interface PlatformStackProps extends StackProps {
  /**
   * Optional stack name suffix for services with several stacks
   * (`Orders` -> `Orders-Api`). Omit for the main stack.
   */
  readonly name?: string;
  /**
   * Config override. Defaults to the config of the enclosing `PlatformApp`;
   * required when the stack is created inside a plain `cdk.App`.
   */
  readonly config?: PlatformConfig;
  /** Route alarms to the alert topics in preview stacks too. Default false. */
  readonly alertingInPreview?: boolean;
}

/** Helpers for routing alarms to the environment's alert topics. */
export interface PlatformAlerting {
  /** False in preview stacks (unless `alertingInPreview`), so alarms exist but stay quiet. */
  readonly enabled: boolean;
  topic(severity: AlertSeverity): ITopic;
}

export const PLATFORM_TAGS = {
  project: "platform:project",
  service: "platform:service",
  env: "platform:env",
  previewId: "platform:preview-id",
  prNumber: "platform:pr-number",
  repository: "platform:repository",
  managedBy: "platform:managed-by",
  severity: "platform:severity",
  component: "platform:component",
} as const;

/**
 * Base stack for every platform service. Names, tags, removal policy, log
 * retention, SSM parameter access and alert routing all flow from here.
 */
export class PlatformStack extends Stack {
  /** The enclosing PlatformStack, or throw. */
  static override of(scope: IConstruct): PlatformStack {
    const stack = Stack.of(scope);
    if (!(stack instanceof PlatformStack)) {
      throw new Error(
        `${scope.node.path} is not inside a PlatformStack. Platform constructs must be created within a PlatformStack.`,
      );
    }
    return stack;
  }

  static isPlatformStack(scope: IConstruct): boolean {
    return Stack.of(scope) instanceof PlatformStack;
  }

  readonly config: PlatformConfig;
  readonly context: PlatformContext;
  readonly naming: PlatformNaming;
  readonly params: PlatformParameters;
  readonly alerts: PlatformAlerting;
  readonly removalPolicy: RemovalPolicy;
  readonly logRetention: RetentionDays;
  readonly isPreview: boolean;
  readonly previewId: string | undefined;
  readonly envName: string;

  constructor(scope: Construct, id: string, props: PlatformStackProps = {}) {
    const app = PlatformApp.tryOf(scope);
    const config = props.config ?? app?.config;
    if (!config) {
      throw new Error(
        "PlatformStack needs a config: create it inside a PlatformApp or pass `config` in the props.",
      );
    }
    const context = app && !props.config ? app.context : resolvePlatformContext(scope, config);
    const naming = app && !props.config ? app.naming : createNaming(context);

    super(scope, id, {
      ...props,
      stackName: props.stackName ?? naming.stack(props.name),
      env: props.env ?? {
        ...(context.account ? { account: context.account } : {}),
        region: context.region,
      },
      description:
        props.description ??
        `${config.project} / ${config.service} (${context.env}${context.previewId ? `, preview ${context.previewId}` : ""})`,
    });

    this.config = config;
    this.context = context;
    this.naming = naming;
    this.removalPolicy = context.removalPolicy;
    this.logRetention = context.logRetention;
    this.isPreview = context.isPreview;
    this.previewId = context.previewId;
    this.envName = context.env;
    this.params = new PlatformParameters(this, {
      env: context.env,
      rootPrefix: config.ssmRootPrefix,
    });

    const alertingEnabled = !context.isPreview || props.alertingInPreview === true;
    this.alerts = {
      enabled: alertingEnabled,
      topic: (severity) => this.params.env.alertTopic(severity),
    };

    Tags.of(this).add(PLATFORM_TAGS.project, config.project);
    Tags.of(this).add(PLATFORM_TAGS.service, config.service);
    Tags.of(this).add(PLATFORM_TAGS.env, context.env);
    Tags.of(this).add(PLATFORM_TAGS.managedBy, "platform-cdk");
    if (context.previewId) Tags.of(this).add(PLATFORM_TAGS.previewId, context.previewId);
    if (context.prNumber) Tags.of(this).add(PLATFORM_TAGS.prNumber, context.prNumber);
    if (config.github)
      Tags.of(this).add(PLATFORM_TAGS.repository, `${config.github.owner}/${config.github.repo}`);
    for (const [key, value] of Object.entries(config.tags)) {
      Tags.of(this).add(key, value);
    }
  }

  /** Hostname for this service in the current environment, if a domain is configured. */
  get domainName(): string | undefined {
    return this.naming.domain();
  }
}
