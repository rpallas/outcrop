import { Duration } from "aws-cdk-lib";
import { HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { AttributeType } from "aws-cdk-lib/aws-dynamodb";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import type { Construct } from "constructs";
import { PlatformDashboard } from "../src/alerting/dashboard";
import { PlatformBucket } from "../src/constructs/bucket";
import { PlatformCustomResource } from "../src/constructs/custom-resource";
import { PlatformFunction } from "../src/constructs/function";
import { PlatformHttpApi, PlatformHttpAuthorizers } from "../src/constructs/http-api";
import { PlatformQueue } from "../src/constructs/queue";
import { PlatformTable } from "../src/constructs/table";
import { PlatformStack, type PlatformStackProps } from "../src/core/platform-stack";
import { HANDLER_ENTRY } from "./fixtures";

/**
 * Exercises every M1 construct in one stack. Used for the snapshot test, the
 * cdk-nag run and the milestone acceptance criteria.
 */
export class KitchenSinkStack extends PlatformStack {
  constructor(scope: Construct, id: string, props?: PlatformStackProps) {
    super(scope, id, props);

    const table = new PlatformTable(this, "Orders", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      timeToLiveAttribute: "ttl",
      stream: true,
    });
    table.addGsi({ partitionKey: { name: "gsi1pk", type: AttributeType.STRING } });
    table.alarms.throttles();

    const uploads = new PlatformBucket(this, "Uploads", { expireAfterDays: 30 });

    const jobs = new PlatformQueue(this, "Jobs", {
      deadLetterQueue: true,
      visibilityTimeout: Duration.seconds(90),
    });
    jobs.alarms.dlqDepth();
    jobs.alarms.age();

    const api = new PlatformHttpApi(this, "Api", {
      cors: true,
      defaultAuthorizer: PlatformHttpAuthorizers.auth0(
        "example.eu.auth0.com",
        "https://api.example.com",
      ),
    });

    const handler = new PlatformFunction(this, "Handler", {
      entry: HANDLER_ENTRY,
      environment: {
        TABLE_NAME: table.tableName,
        BUCKET_NAME: uploads.bucketName,
        QUEUE_URL: jobs.queueUrl,
      },
    });
    table.grantReadWriteData(handler);
    uploads.grantReadWrite(handler);
    jobs.grantSendMessages(handler);
    handler.addStandardAlarms();

    api.addLambdaRoute("/orders", [HttpMethod.GET, HttpMethod.POST], handler);
    api.addLambdaRoute("/health", HttpMethod.GET, handler, {
      authorizer: PlatformHttpAuthorizers.iam(),
    });
    api.alarms.serverErrors();
    api.alarms.latency();

    const worker = new PlatformFunction(this, "Worker", {
      entry: HANDLER_ENTRY,
      deadLetterQueue: true,
      timeout: Duration.seconds(60),
    });
    worker.addEventSource(
      new SqsEventSource(jobs, { batchSize: 10, reportBatchItemFailures: true }),
    );
    table.grantReadWriteData(worker);
    worker.alarms.errors();

    uploads.onObjectCreatedEnqueue(jobs, { prefix: "incoming/" });

    const seedHandler = PlatformCustomResource.handler(this, "SeedHandler", {
      entry: HANDLER_ENTRY,
    });
    table.grantWriteData(seedHandler);
    new PlatformCustomResource<{ TableName: string; Version: string }>(this, "Seed", {
      resourceType: "Custom::PlatformSeed",
      onEvent: seedHandler,
      properties: { TableName: table.tableName, Version: "1" },
    });

    new PlatformDashboard(this, "Dashboard")
      .addHeader(`# ${this.config.service} (${this.envName})`)
      .addMetricRow([
        { title: "API requests", left: [api.metricCount()], right: [api.metricServerError()] },
        { title: "Handler", left: [handler.metricInvocations()], right: [handler.metricErrors()] },
        { title: "Queue", left: [jobs.metricApproximateNumberOfMessagesVisible()] },
      ]);
  }
}
