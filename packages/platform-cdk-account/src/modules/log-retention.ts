import { Duration, Stack } from "aws-cdk-lib";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  Architecture,
  Code,
  Function as LambdaFunctionConstruct,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { ResourceKind } from "@rpallas/platform-cdk";
import { Construct } from "constructs";
import { type BaselineModuleProps, baselineRemovalPolicy, publishParameter } from "./base";

export interface LogRetentionProps extends BaselineModuleProps {
  /** Retention applied to log groups that have none. Defaults to `environment.logRetentionDays`. */
  readonly retentionDays?: number;
  /** How often to sweep for log groups without retention. Default every hour. */
  readonly sweepInterval?: Duration;
  /** Also react to `CreateLogGroup` API calls (requires CloudTrail management events). Default true. */
  readonly onCreateLogGroup?: boolean;
  /** Log group name prefixes to leave alone. */
  readonly excludePrefixes?: string[];
}

/**
 * Inline handler: lists log groups and applies the default retention to any
 * group that has none. Uses the AWS SDK v3 bundled with the Lambda runtime.
 */
const HANDLER_CODE = `
const { CloudWatchLogsClient, DescribeLogGroupsCommand, PutRetentionPolicyCommand } = require("@aws-sdk/client-cloudwatch-logs");
const client = new CloudWatchLogsClient({});
const retention = Number(process.env.RETENTION_DAYS);
const excluded = (process.env.EXCLUDE_PREFIXES || "").split(",").filter(Boolean);
exports.handler = async (event) => {
  const single = event?.detail?.requestParameters?.logGroupName;
  let updated = 0;
  let nextToken;
  do {
    const page = await client.send(new DescribeLogGroupsCommand(single ? { logGroupNamePrefix: single } : { nextToken }));
    for (const group of page.logGroups || []) {
      if (group.retentionInDays || excluded.some((p) => group.logGroupName.startsWith(p))) continue;
      await client.send(new PutRetentionPolicyCommand({ logGroupName: group.logGroupName, retentionInDays: retention }));
      updated += 1;
    }
    nextToken = single ? undefined : page.nextToken;
  } while (nextToken);
  console.log(JSON.stringify({ message: "log retention applied", updated, retention }));
  return { updated };
};
`;

/**
 * Applies a default retention to every CloudWatch log group that has none, on a
 * schedule and (optionally) whenever a log group is created. Publishes the value
 * to `/platform/account/log-retention-days` so constructs can align with it.
 */
export class LogRetention extends Construct {
  readonly handler: LambdaFunctionConstruct;

  constructor(scope: Construct, id: string, props: LogRetentionProps) {
    super(scope, id);
    const { context } = props;
    const stack = Stack.of(this);
    const retentionDays = props.retentionDays ?? context.environment.logRetentionDays;

    const logGroup = new LogGroup(this, "HandlerLogGroup", {
      logGroupName: `/aws/lambda/${context.naming.resource(ResourceKind.LambdaFunction, "log-retention")}`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: baselineRemovalPolicy(context),
    });
    this.handler = new LambdaFunctionConstruct(this, "Handler", {
      functionName: context.naming.resource(ResourceKind.LambdaFunction, "log-retention"),
      description: "Applies the platform default retention to log groups without one",
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      handler: "index.handler",
      code: Code.fromInline(HANDLER_CODE),
      timeout: Duration.minutes(5),
      memorySize: 256,
      logGroup,
      environment: {
        RETENTION_DAYS: String(retentionDays),
        EXCLUDE_PREFIXES: (props.excludePrefixes ?? []).join(","),
      },
    });
    this.handler.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["logs:DescribeLogGroups", "logs:PutRetentionPolicy"],
        resources: [stack.formatArn({ service: "logs", resource: "log-group", resourceName: "*" })],
      }),
    );

    new Rule(this, "Sweep", {
      description: "Periodic sweep for log groups without retention",
      schedule: Schedule.rate(props.sweepInterval ?? Duration.hours(1)),
      targets: [new LambdaFunction(this.handler)],
    });
    if (props.onCreateLogGroup !== false) {
      new Rule(this, "OnCreateLogGroup", {
        description: "Apply retention as soon as a log group is created",
        eventPattern: {
          source: ["aws.logs"],
          detailType: ["AWS API Call via CloudTrail"],
          detail: { eventSource: ["logs.amazonaws.com"], eventName: ["CreateLogGroup"] },
        },
        targets: [new LambdaFunction(this.handler)],
      });
    }

    publishParameter(
      this,
      "RetentionParam",
      context.paths.account.logRetentionDays(),
      String(retentionDays),
    );
  }
}
