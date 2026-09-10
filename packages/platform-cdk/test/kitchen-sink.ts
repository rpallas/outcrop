import { Duration } from "aws-cdk-lib";
import { AuthorizationType } from "aws-cdk-lib/aws-apigateway";
import { HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { WebSocketIamAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { AttributeType } from "aws-cdk-lib/aws-dynamodb";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { DefinitionBody, Pass } from "aws-cdk-lib/aws-stepfunctions";
import type { Construct } from "constructs";
import { PlatformDashboard } from "../src/alerting/dashboard";
import { serviceDashboard } from "../src/alerting/service-dashboard";
import { PlatformBucket } from "../src/constructs/bucket";
import { PlatformCustomResource } from "../src/constructs/custom-resource";
import { PlatformDeliveryStream } from "../src/constructs/delivery-stream";
import { PlatformEmailIdentity } from "../src/constructs/email-identity";
import { PlatformEventBus } from "../src/constructs/event-bus";
import { PlatformEventRule } from "../src/constructs/event-rule";
import { PlatformFunction } from "../src/constructs/function";
import { PlatformHttpApi, PlatformHttpAuthorizers } from "../src/constructs/http-api";
import { PlatformKey } from "../src/constructs/key";
import { PlatformParameter } from "../src/constructs/parameter";
import { PlatformPythonFunction } from "../src/constructs/python-function";
import { PlatformQueue } from "../src/constructs/queue";
import { PlatformRestApi } from "../src/constructs/rest-api";
import { PlatformSchedule } from "../src/constructs/schedule";
import { PlatformSecret } from "../src/constructs/secret";
import { PlatformStateMachine } from "../src/constructs/state-machine";
import { PlatformStaticSite } from "../src/constructs/static-site";
import { PlatformStream } from "../src/constructs/stream";
import { PlatformTable } from "../src/constructs/table";
import { PlatformTopic } from "../src/constructs/topic";
import { PlatformUserPool } from "../src/constructs/user-pool";
import { PlatformWebAcl } from "../src/constructs/web-acl";
import { PlatformWebSocketApi } from "../src/constructs/websocket-api";
import { PlatformStack, type PlatformStackProps } from "../src/core/platform-stack";
import { HANDLER_ENTRY, PYTHON_ENTRY, tmpSiteDir } from "./fixtures";

/**
 * Exercises every construct in one stack. Used for the snapshot test, the
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

    // Messaging: topic, custom bus, rule on the platform bus and a schedule.
    const notifications = new PlatformTopic(this, "Notifications");
    notifications.addLambdaSubscription(worker);
    notifications.addQueueSubscription(jobs);
    notifications.alarms.failedNotifications();

    const domainBus = new PlatformEventBus(this, "DomainBus", {
      archive: { retention: Duration.days(7) },
    });
    domainBus.grantPutEvents(handler);
    domainBus.alarms.failedInvocations();

    const flow = new PlatformStateMachine(this, "OrderFlow", {
      definitionBody: DefinitionBody.fromChainable(new Pass(this, "Start")),
      timeout: Duration.minutes(5),
    });
    flow.alarms.failed();
    flow.alarms.duration();

    const onOrderEvents = new PlatformEventRule(this, "OnOrderEvents", {
      eventNames: ["order.created", "order.updated"],
      source: "checkout",
      targets: [worker, jobs, flow, notifications],
      deadLetterQueue: true,
    });
    onOrderEvents.alarms.failedInvocations();
    onOrderEvents.alarms.deadLetter();

    const nightly = new PlatformSchedule(this, "Nightly", {
      schedule: "cron(0 2 * * ? *)",
      target: worker,
      input: { job: "cleanup" },
      deadLetterQueue: true,
    });
    nightly.alarms.failedInvocations();

    // Secrets, keys and parameters.
    const key = new PlatformKey(this, "DataKey");
    const apiKeySecret = new PlatformSecret(this, "ApiKey", {
      name: "api-key",
      generate: { length: 40 },
      encryptionKey: key,
    });
    apiKeySecret.grantRead(handler);
    new PlatformParameter(this, "ApiUrlParameter", { key: "api-url", value: api.baseUrl });

    // Web: WAF + REST API, WebSocket API, static site with API origin.
    const firewall = new PlatformWebAcl(this, "Firewall", { rateLimit: 1000 });
    const restApi = new PlatformRestApi(this, "AdminApi", {
      domain: "admin.dev.example.com",
      webAcl: firewall,
    });
    const validator = restApi.addValidator("default");
    restApi.addLambdaRoute("/admin/orders/{id}", [HttpMethod.GET, HttpMethod.DELETE], handler, {
      authorizationType: AuthorizationType.IAM,
      requestValidator: validator,
      apiKeyRequired: true,
    });
    restApi.addUsagePlan({
      throttle: { rateLimit: 10, burstLimit: 20 },
      apiKeys: [restApi.addApiKey("Admin")],
    });
    restApi.alarms.serverErrors();
    firewall.alarms.blockedRequests();

    const ws = new PlatformWebSocketApi(this, "Realtime", {
      connectHandler: handler,
      connectAuthorizer: new WebSocketIamAuthorizer(),
      disconnectHandler: handler,
      defaultHandler: handler,
      routes: { subscribe: handler },
    });
    ws.grantManageConnections(handler);
    ws.alarms.serverErrors();

    const site = new PlatformStaticSite(this, "Site", {
      sourcePath: tmpSiteDir(),
      spa: true,
      domainPattern: "app-{service}.{envDomain}",
      apiOrigin: { api, pathPattern: "/api/*" },
    });
    site.distribution.alarms.serverErrors();

    const users = new PlatformUserPool(this, "Users");
    users.addHostedUiClient({ callbackUrls: [`${site.url}/callback`], logoutUrls: [site.url] });
    users.alarms.signInThrottles();
    api.addLambdaRoute("/me", HttpMethod.GET, handler, {
      authorizer: PlatformHttpAuthorizers.cognito(users, {
        userPoolClients: [users.defaultClient],
      }),
    });

    const mail = new PlatformEmailIdentity(this, "Mail", { mailFrom: true });
    mail.grantSend(handler, ["no-reply@orders.dev.example.com"]);
    mail.alarms.bounceRate();

    // Streaming: Kinesis stream archived to S3 by Firehose, plus a Python consumer.
    const clicks = new PlatformStream(this, "Clicks");
    clicks.grantWrite(handler);
    clicks.alarms.iteratorAge();
    const archive = new PlatformDeliveryStream(this, "ClicksArchive", { source: clicks });
    archive.alarms.deliveryFailures();

    const report = new PlatformPythonFunction(this, "Report", {
      entry: PYTHON_ENTRY,
      deadLetterQueue: true,
      environment: { TABLE_NAME: table.tableName },
    });
    table.grantReadData(report);
    report.addStandardAlarms();

    new PlatformDashboard(this, "Dashboard")
      .addHeader(`# ${this.config.service} (${this.envName})`)
      .addMetricRow([
        { title: "API requests", left: [api.metricCount()], right: [api.metricServerError()] },
        { title: "Handler", left: [handler.metricInvocations()], right: [handler.metricErrors()] },
        { title: "Queue", left: [jobs.metricApproximateNumberOfMessagesVisible()] },
      ]);
    serviceDashboard(this, { name: "service" });
  }
}
