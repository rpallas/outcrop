import { Duration, Stack } from "aws-cdk-lib";
import { CfnEventBusPolicy, EventBus, Rule } from "aws-cdk-lib/aws-events";
import { CloudWatchLogGroup } from "aws-cdk-lib/aws-events-targets";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { ResourceKind } from "@rpallas/outcrop";
import { Construct } from "constructs";
import { type BaselineModuleProps, baselineRemovalPolicy, output, publishParameter } from "./base";

export interface EventBusModuleProps extends BaselineModuleProps {
  /** Archive every event for replay. Default 30 days; `false` disables the archive. */
  readonly archiveRetention?: Duration | false;
  /** Allow every account in the organisation to `PutEvents` on the bus. */
  readonly allowOrganizationId?: string;
  /** Additional account ids allowed to `PutEvents`. */
  readonly allowAccountIds?: string[];
  /** Mirror all events into a CloudWatch log group (handy in dev, noisy in prod). Default false. */
  readonly logAllEvents?: boolean;
}

/**
 * The environment event bus `platform-<env>` with an archive and optional
 * cross-account policy. Published to `/platform/env/{env}/events/bus-name` and
 * `bus-arn`; `PlatformEventRule` and the runtime `publishEvent` use it.
 */
export class EventBusModule extends Construct {
  readonly bus: EventBus;

  constructor(scope: Construct, id: string, props: EventBusModuleProps) {
    super(scope, id);
    const { context } = props;
    const stack = Stack.of(this);
    const paths = context.paths.env(context.env);

    this.bus = new EventBus(this, "Bus", {
      eventBusName: context.naming.resource(ResourceKind.EventBus, "events"),
      description: `${context.config.project} ${context.env} platform events`,
    });
    this.bus.applyRemovalPolicy(baselineRemovalPolicy(context));

    if (props.archiveRetention !== false) {
      this.bus.archive("Archive", {
        archiveName: context.naming.resource(ResourceKind.Generic, "events-archive"),
        description: `All events on ${this.bus.eventBusName}`,
        eventPattern: { account: [stack.account] },
        retention: props.archiveRetention ?? Duration.days(30),
      });
    }

    // One policy resource per statement: CloudFormation only accepts a single statement each.
    if (props.allowOrganizationId !== undefined) {
      new CfnEventBusPolicy(this, "OrganizationPolicy", {
        eventBusName: this.bus.eventBusName,
        statementId: `${context.config.project}-${context.env}-organization`,
        statement: {
          Sid: "AllowOrganizationPutEvents",
          Effect: "Allow",
          Principal: "*",
          Action: "events:PutEvents",
          Resource: this.bus.eventBusArn,
          Condition: { StringEquals: { "aws:PrincipalOrgID": props.allowOrganizationId } },
        },
      });
    }
    for (const account of props.allowAccountIds ?? []) {
      new CfnEventBusPolicy(this, `Account${account}Policy`, {
        eventBusName: this.bus.eventBusName,
        statementId: `${context.config.project}-${context.env}-account-${account}`,
        statement: {
          Sid: `AllowAccount${account}PutEvents`,
          Effect: "Allow",
          Principal: { AWS: `arn:${stack.partition}:iam::${account}:root` },
          Action: "events:PutEvents",
          Resource: this.bus.eventBusArn,
        },
      });
    }

    if (props.logAllEvents === true) {
      const logGroup = new LogGroup(this, "AllEventsLog", {
        logGroupName: `/${context.naming.resource(ResourceKind.LogGroup, "events")}`,
        retention: RetentionDays.ONE_WEEK,
        removalPolicy: baselineRemovalPolicy(context),
      });
      new Rule(this, "LogAllEvents", {
        eventBus: this.bus,
        eventPattern: { account: [stack.account] },
        targets: [new CloudWatchLogGroup(logGroup)],
      });
    }

    publishParameter(this, "BusNameParam", paths.eventBusName(), this.bus.eventBusName);
    publishParameter(this, "BusArnParam", paths.eventBusArn(), this.bus.eventBusArn);
    output(this, "EventBusName", this.bus.eventBusName);
  }
}
