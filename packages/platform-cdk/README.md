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
- `PlatformAlarm`, `PlatformDashboard`, `alertTopic`
- `PlatformFunction`, `PlatformTable`, `PlatformQueue`, `PlatformBucket`, `PlatformHttpApi` (+ `PlatformHttpAuthorizers`), `PlatformCustomResource`
- Topic, EventBus/Rule/Schedule, StateMachine, StaticSite, UserPool, Key/Secret/Parameter, WebAcl, RestApi, WebSocketApi, EmailIdentity, Kinesis/Firehose, Python functions

See the repository `docs/` for conventions and ADRs.
