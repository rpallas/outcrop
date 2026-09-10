import path from "node:path";
import { Duration } from "aws-cdk-lib";
import { Architecture, Runtime, Tracing } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { ISecret } from "aws-cdk-lib/aws-secretsmanager";
import type { ITopic } from "aws-cdk-lib/aws-sns";
import { LambdaSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { type IQueue, Queue } from "aws-cdk-lib/aws-sqs";
import {
  ALERT_SEVERITIES,
  type AlertSeverity,
  lambdaEntry,
  type PlatformAlarm,
  PlatformFunction,
  PlatformStack,
} from "@rpallas/platform-cdk";
import { Construct } from "constructs";
import { type ChatOpsKind, DESTINATIONS_ENV, type DestinationConfig } from "./handlers/notify";

export const DEFAULT_WEBHOOK_SECRET_NAMES: Readonly<Record<ChatOpsKind, string>> = {
  slack: "slack-webhook",
  teams: "teams-webhook",
};

export interface ChatOpsDestination {
  /** Chat provider; selects the payload format. */
  readonly kind: ChatOpsKind;
  /**
   * Name of the shared secret (published by the account baseline under
   * `/platform/secrets/{name}/arn`) holding the incoming webhook URL.
   * Default `slack-webhook` / `teams-webhook`. Requires a `PlatformStack`.
   */
  readonly webhookSecretName?: string;
  /** Explicit webhook secret instead of `webhookSecretName`. */
  readonly webhookSecret?: ISecret;
  /** Lowest severity delivered to this destination. Default `low` (everything). */
  readonly minimumSeverity?: AlertSeverity;
  /** Free-text label rendered in the message, for example the channel name. */
  readonly channelLabel?: string;
}

export interface ChatOpsNotifierProps {
  /**
   * Topics to subscribe to. Default: the environment alert topics published by
   * the account baseline (`/platform/env/{env}/alerts/topic-arn/{severity}`), which
   * requires a `PlatformStack`.
   */
  readonly topics?: ITopic[];
  /** Only subscribe to these severities when using the default topics. Default: all four. */
  readonly severities?: AlertSeverity[];
  /** Where to deliver messages. At least one. */
  readonly destinations: ChatOpsDestination[];
  /**
   * Send failed deliveries to a dead letter queue. Default true. Pass an
   * existing queue to reuse it.
   */
  readonly deadLetterQueue?: boolean | IQueue;
  /**
   * Create the `errors` alarm on the notifier function (routed to the
   * environment's `high` topic). Default true inside a `PlatformStack`; never
   * created in a plain `Stack`.
   */
  readonly errorAlarm?: boolean;
  /** Function timeout. Default 30 seconds. */
  readonly timeout?: Duration;
}

/**
 * Delivers SNS alert notifications (CloudWatch alarms, AWS Budgets, EventBridge
 * events or plain text) to Slack and Microsoft Teams incoming webhooks.
 *
 * Inside a `PlatformStack` the topics and webhook secrets default to the account
 * baseline's contract and the function is a `PlatformFunction` with the usual
 * naming, log retention and alarms. In a plain `Stack` (for example the account
 * baseline itself) pass explicit `topics` and a `webhookSecret` per destination.
 */
export class ChatOpsNotifier extends Construct {
  /** The notifier function (`PlatformFunction` inside a `PlatformStack`). */
  readonly handler: NodejsFunction;
  /** Topics this notifier is subscribed to. */
  readonly topics: readonly ITopic[];
  /** Resolved destinations with their secrets. */
  readonly destinations: readonly {
    readonly config: DestinationConfig;
    readonly secret: ISecret;
  }[];
  /** Dead letter queue when enabled. */
  readonly deadLetterQueue: IQueue | undefined;
  /** Errors alarm when created. */
  readonly errorAlarm: PlatformAlarm | undefined;

  constructor(scope: Construct, id: string, props: ChatOpsNotifierProps) {
    super(scope, id);
    if (props.destinations.length === 0) {
      throw new Error(`${this.node.path}: at least one destination is required`);
    }
    const platformStack = PlatformStack.isPlatformStack(this) ? PlatformStack.of(this) : undefined;

    const topics = props.topics ?? defaultTopics(platformStack, props.severities, this.node.path);
    if (topics.length === 0) throw new Error(`${this.node.path}: no topics to subscribe to`);
    if (props.topics && props.severities) {
      throw new Error(`${this.node.path}: \`severities\` only applies to the default topics`);
    }

    const destinations = props.destinations.map((destination) => {
      const secret =
        destination.webhookSecret ?? sharedSecret(platformStack, destination, this.node.path);
      const config: DestinationConfig = {
        kind: destination.kind,
        webhookSecretArn: secret.secretArn,
        minimumSeverity: destination.minimumSeverity ?? "low",
        ...(destination.channelLabel !== undefined
          ? { channelLabel: destination.channelLabel }
          : {}),
      };
      return { config, secret };
    });

    const entry = lambdaEntry(path.join(__dirname, "handlers", "notify"));
    const timeout = props.timeout ?? Duration.seconds(30);
    const environment = {
      [DESTINATIONS_ENV]: JSON.stringify(destinations.map((d) => d.config)),
    };
    const dlqOption = props.deadLetterQueue ?? true;

    let handler: NodejsFunction;
    let dlq: IQueue | undefined;
    let errorAlarm: PlatformAlarm | undefined;
    if (platformStack) {
      const fn = new PlatformFunction(this, "Handler", {
        entry,
        description: "platform-cdk-chatops: delivers alert notifications to chat webhooks",
        timeout,
        memorySize: 256,
        deadLetterQueue: dlqOption,
        environment,
      });
      handler = fn;
      dlq = fn.dlq;
      if (props.errorAlarm !== false) errorAlarm = fn.alarms.errors();
    } else {
      if (dlqOption === true) {
        dlq = new Queue(this, "Dlq", { retentionPeriod: Duration.days(14), enforceSSL: true });
      } else if (dlqOption) {
        dlq = dlqOption;
      }
      handler = new NodejsFunction(this, "Handler", {
        entry,
        description: "platform-cdk-chatops: delivers alert notifications to chat webhooks",
        runtime: Runtime.NODEJS_24_X,
        architecture: Architecture.ARM_64,
        memorySize: 256,
        timeout,
        tracing: Tracing.ACTIVE,
        logGroup: new LogGroup(this, "HandlerLogGroup", { retention: RetentionDays.ONE_MONTH }),
        ...(dlq ? { deadLetterQueue: dlq } : {}),
        bundling: { minify: true, sourceMap: true, format: OutputFormat.CJS, target: "node24" },
        environment: { NODE_OPTIONS: "--enable-source-maps", ...environment },
      });
    }

    for (const { secret } of destinations) secret.grantRead(handler);
    for (const topic of topics) topic.addSubscription(new LambdaSubscription(handler));

    this.handler = handler;
    this.topics = topics;
    this.destinations = destinations;
    this.deadLetterQueue = dlq;
    this.errorAlarm = errorAlarm;
  }
}

const defaultTopics = (
  stack: PlatformStack | undefined,
  severities: AlertSeverity[] | undefined,
  path: string,
): ITopic[] => {
  if (!stack) {
    throw new Error(
      `${path}: pass \`topics\` explicitly when ChatOpsNotifier is not inside a PlatformStack`,
    );
  }
  const selected = severities ?? [...ALERT_SEVERITIES];
  return selected.map((severity) => stack.params.env.alertTopic(severity));
};

const sharedSecret = (
  stack: PlatformStack | undefined,
  destination: ChatOpsDestination,
  path: string,
): ISecret => {
  if (!stack) {
    throw new Error(
      `${path}: pass \`webhookSecret\` for the ${destination.kind} destination when ChatOpsNotifier is not inside a PlatformStack`,
    );
  }
  return stack.params.secret(
    destination.webhookSecretName ?? DEFAULT_WEBHOOK_SECRET_NAMES[destination.kind],
  );
};
