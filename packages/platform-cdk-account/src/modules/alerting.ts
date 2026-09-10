import { Stack } from "aws-cdk-lib";
import { AnyPrincipal, Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import type { IKey } from "aws-cdk-lib/aws-kms";
import { type ITopic, Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import {
  ALERT_SEVERITIES,
  type AlertSeverity,
  PLATFORM_TAGS,
  ResourceKind,
} from "@rpallas/platform-cdk";
import { Construct } from "constructs";
import { Tags } from "aws-cdk-lib";
import { type BaselineModuleProps, output, publishParameter } from "./base";

export interface AlertingProps extends BaselineModuleProps {
  /** Email subscriptions per severity. Defaults to `environment.alertEmails` for every severity. */
  readonly emails?: Partial<Record<AlertSeverity, string[]>>;
  /** Encrypt topics with this key (typically `Encryption.key`). */
  readonly kmsKey?: IKey;
  /** Allow the whole organisation to publish to the topics (cross-account alarms). */
  readonly allowOrganizationId?: string;
}

/**
 * One SNS topic per alert severity with email subscriptions, publish permissions
 * for CloudWatch alarms and EventBridge, and SSM parameters at
 * `/platform/env/{env}/alerts/topic-arn/{severity}`. Integrations such as
 * `@rpallas/platform-cdk-chatops` subscribe to `topics`.
 */
export class Alerting extends Construct {
  readonly topics: Readonly<Record<AlertSeverity, Topic>>;

  constructor(scope: Construct, id: string, props: AlertingProps) {
    super(scope, id);
    const { context } = props;
    const stack = Stack.of(this);
    const paths = context.paths.env(context.env);

    const topics = {} as Record<AlertSeverity, Topic>;
    for (const severity of ALERT_SEVERITIES) {
      const topic = new Topic(
        this,
        `${severity[0]?.toUpperCase() ?? ""}${severity.slice(1)}Topic`,
        {
          topicName: context.naming.resource(ResourceKind.SnsTopic, `alerts-${severity}`),
          displayName: `${context.config.project} ${context.env} ${severity} alerts`,
          enforceSSL: true,
          ...(props.kmsKey ? { masterKey: props.kmsKey } : {}),
        },
      );
      Tags.of(topic).add(PLATFORM_TAGS.severity, severity);
      topic.addToResourcePolicy(
        new PolicyStatement({
          sid: "AllowAwsServicesToPublish",
          effect: Effect.ALLOW,
          principals: [
            new ServicePrincipal("cloudwatch.amazonaws.com"),
            new ServicePrincipal("events.amazonaws.com"),
            new ServicePrincipal("budgets.amazonaws.com"),
          ],
          actions: ["sns:Publish"],
          resources: [topic.topicArn],
          conditions: { StringEquals: { "aws:SourceAccount": stack.account } },
        }),
      );
      if (props.allowOrganizationId !== undefined) {
        topic.addToResourcePolicy(
          new PolicyStatement({
            sid: "AllowOrganizationToPublish",
            effect: Effect.ALLOW,
            principals: [new AnyPrincipal()],
            actions: ["sns:Publish"],
            resources: [topic.topicArn],
            conditions: { StringEquals: { "aws:PrincipalOrgID": props.allowOrganizationId } },
          }),
        );
      }
      const emails = props.emails?.[severity] ?? context.environment.alertEmails;
      for (const email of emails) topic.addSubscription(new EmailSubscription(email));
      publishParameter(
        this,
        `${severity}TopicArnParam`,
        paths.alertTopicArn(severity),
        topic.topicArn,
      );
      topics[severity] = topic;
    }
    this.topics = topics;
    output(this, "CriticalAlertTopicArn", topics.critical.topicArn);
  }

  topic(severity: AlertSeverity): ITopic {
    return this.topics[severity];
  }
}
