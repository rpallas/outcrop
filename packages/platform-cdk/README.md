# @rpallas/platform-cdk

Lambda-first AWS CDK constructs with preview-stack support.

```bash
npm install @rpallas/platform-cdk aws-cdk-lib constructs
```

## Usage

```ts
// platform.config.ts
import { definePlatformConfig } from "@rpallas/platform-cdk";

export default definePlatformConfig({
  project: "Example Platform",
  service: "orders",
  environments: {
    dev: { account: "111111111111", region: "eu-west-1", domain: "dev.example.com" },
    prod: { account: "222222222222", region: "eu-west-1", domain: "example.com", protected: true },
  },
  github: { owner: "example-org", repo: "orders" },
});
```

```ts
// infra/bin/app.ts
import { PlatformApp } from "@rpallas/platform-cdk";
import config from "../../platform.config";
import { ServiceStack } from "../lib/service-stack";

const app = new PlatformApp({ config });
new ServiceStack(app, "Service");
```

```ts
// infra/lib/service-stack.ts
import { HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { AttributeType } from "aws-cdk-lib/aws-dynamodb";
import {
  lambdaEntry,
  PlatformFunction,
  PlatformHttpApi,
  PlatformStack,
  PlatformTable,
} from "@rpallas/platform-cdk";

export class ServiceStack extends PlatformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    const table = new PlatformTable(this, "Orders", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
    });
    const handler = new PlatformFunction(this, "Handler", {
      entry: lambdaEntry("app/src/handlers/orders"),
      environment: { TABLE_NAME: table.tableName },
    });
    table.grantReadWriteData(handler);
    const api = new PlatformHttpApi(this, "Api", { cors: true });
    api.addLambdaRoute("/orders", [HttpMethod.GET, HttpMethod.POST], handler);
    handler.addStandardAlarms();
  }
}
```

```bash
npx cdk deploy -c env=dev
npx cdk deploy -c env=dev -c preview=true -c previewId=abc-123
```

## What you get

- `PlatformApp` / `PlatformStack`: context resolution, tags, removal policy, log retention, SSM parameter access, alert routing
- `PlatformNaming`: deterministic physical names with per-resource limits and preview prefixes
- `PlatformParameters`: typed reader for the `/platform/...` SSM contract written by `@rpallas/platform-cdk-account`
- `PlatformAlarm`, `PlatformDashboard`, `serviceDashboard`, `alertTopic`
- The constructs below

Every construct derives physical names through `PlatformNaming`, applies the stack removal policy and tags, uses short log retention / `DESTROY` / no deletion protection in preview stacks, and exposes an `alarms` object whose helpers return `PlatformAlarm`s routed to the environment alert topics (silent in previews unless the stack opts in).

## Constructs

| Construct                                                            | Wraps                              | Highlights                                                                                           |
| -------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`PlatformFunction`](../../docs/constructs/function.md)              | `NodejsFunction`                   | ARM64, X-Ray, explicit log group, platform env vars, optional DLQ, `addStandardAlarms()`             |
| [`PlatformHttpApi`](../../docs/constructs/http-api.md)               | `HttpApi`                          | Access logs, throttling, CORS, custom domain + Route 53, `addLambdaRoute`, `PlatformHttpAuthorizers` |
| [`PlatformRestApi`](../../docs/constructs/rest-api.md)               | `RestApi`                          | JSON access logs, X-Ray, env stage, custom domain, validators, API keys, usage plans, WAF            |
| [`PlatformWebSocketApi`](../../docs/constructs/websocket-api.md)     | `WebSocketApi`                     | `$connect`/`$disconnect`/`$default` + custom routes, env stage, access logs, optional domain         |
| [`PlatformTable`](../../docs/constructs/table.md)                    | `TableV2`                          | On-demand, PITR outside previews, `addGsi`, throttle / system error alarms                           |
| [`PlatformQueue`](../../docs/constructs/queue.md)                    | `Queue`                            | SSE, TLS, optional DLQ, age / depth / DLQ alarms                                                     |
| [`PlatformBucket`](../../docs/constructs/bucket.md)                  | `Bucket`                           | Private, TLS, encryption, lifecycle helpers, notification helpers                                    |
| [`PlatformTopic`](../../docs/constructs/topic.md)                    | `Topic`                            | KMS (account key), TLS policy, Lambda / SQS subscription helpers                                     |
| [`PlatformEventBus`](../../docs/constructs/event-bus.md)             | `EventBus`                         | Named bus, optional archive, `grantPutEvents`, `fromPlatform()` for the environment bus              |
| [`PlatformEventRule`](../../docs/constructs/event-rule.md)           | `Rule`                             | `eventNames` shorthand, automatic target wiring, DLQ, retries                                        |
| [`PlatformSchedule`](../../docs/constructs/schedule.md)              | Scheduler `Schedule`               | `cron()`/`rate()` strings, Lambda / SQS / Step Functions targets, disabled in previews by default    |
| [`PlatformStateMachine`](../../docs/constructs/state-machine.md)     | `StateMachine`                     | Tracing, log group with platform retention, ALL logs in previews                                     |
| [`PlatformDistribution`](../../docs/constructs/distribution.md)      | `Distribution`                     | Custom domain (us-east-1 cert, A/AAAA aliases), TLS 1.2 2021, HTTP/2+3, access logs                  |
| [`PlatformStaticSite`](../../docs/constructs/static-site.md)         | bucket + distribution + deployment | OAC, SPA fallback, security headers, optional API origin                                             |
| [`PlatformUserPool`](../../docs/constructs/user-pool.md)             | `UserPool`                         | Strong password policy, optional MFA, hosted UI client helper, lazy default client                   |
| [`PlatformKey`](../../docs/constructs/key.md)                        | `Key`                              | Rotation, alias from naming, organisation / principal grants                                         |
| [`PlatformSecret`](../../docs/constructs/secret.md)                  | `Secret`                           | Generated or explicit value, ARN published to the SSM contract, `fromPlatform()`                     |
| [`PlatformParameter`](../../docs/constructs/parameter.md)            | `StringParameter`                  | Writes under `/platform/services/{service}/...`, automatic tier, `serviceValue()`                    |
| [`PlatformWebAcl`](../../docs/constructs/web-acl.md)                 | `CfnWebACL`                        | AWS managed rule groups, IP rate limit, REST API association, `forDistribution()`                    |
| [`PlatformEmailIdentity`](../../docs/constructs/email-identity.md)   | SES `EmailIdentity`                | Easy DKIM records in the platform zone, MAIL FROM, configuration set, scoped `grantSend`             |
| [`PlatformCustomResource`](../../docs/constructs/custom-resource.md) | `CustomResource`                   | Shared provider per handler, typed properties                                                        |

### Examples

```ts
// Events and schedules
const bus = new PlatformEventBus(this, "Domain", { archive: { retention: Duration.days(30) } });
bus.grantPutEvents(handler);
new PlatformEventRule(this, "OnOrderEvents", {
  eventNames: ["order.created", "order.updated"], // DetailType as published by the runtime package
  targets: [worker],
  deadLetterQueue: true,
}).alarms.failedInvocations();
new PlatformSchedule(this, "Nightly", { schedule: "cron(0 2 * * ? *)", target: worker });

// Secrets and parameters
const apiKey = new PlatformSecret(this, "ApiKey", { name: "api-key", generate: { length: 40 } });
apiKey.grantRead(handler);
new PlatformParameter(this, "ApiUrl", { key: "api-url", value: api.baseUrl });
const billingUrl = PlatformParameter.serviceValue(this, "billing", "api-url");

// Web
const site = new PlatformStaticSite(this, "Site", {
  sourcePath: "web/dist",
  spa: true,
  apiOrigin: { api, pathPattern: "/api/*" },
});
const users = new PlatformUserPool(this, "Users", { selfSignUp: false });
users.addHostedUiClient({ callbackUrls: [`${site.url}/callback`] });
api.addLambdaRoute("/me", HttpMethod.GET, handler, {
  authorizer: PlatformHttpAuthorizers.cognito(users),
});

// REST API behind WAF
const firewall = new PlatformWebAcl(this, "Firewall", { rateLimit: 1000 });
const admin = new PlatformRestApi(this, "Admin", { webAcl: firewall });
admin.addLambdaRoute("/admin/orders/{id}", [HttpMethod.GET, HttpMethod.DELETE], handler, {
  authorizationType: AuthorizationType.IAM,
  requestValidator: admin.addValidator("default"),
});

// Email
const mail = new PlatformEmailIdentity(this, "Mail", { mailFrom: true });
mail.grantSend(handler, ["no-reply@orders.dev.example.com"]);
mail.alarms.bounceRate();

// One dashboard for everything above
serviceDashboard(this);
```

See the repository `docs/` for conventions, ADRs and one page per construct under `docs/constructs/`.
