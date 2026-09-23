import path from "node:path";
import { AttributeType } from "aws-cdk-lib/aws-dynamodb";
import { HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import {
  lambdaEntry,
  PlatformFunction,
  PlatformHttpApi,
  PlatformStack,
  type PlatformStackProps,
  PlatformTable,
} from "@rpallas/outcrop";
import type { Construct } from "constructs";

export class HelloHttpStack extends PlatformStack {
  readonly table: PlatformTable;
  readonly api: PlatformHttpApi;

  constructor(scope: Construct, id: string, props?: PlatformStackProps) {
    super(scope, id, props);

    // Single-table design: pk/sk plus a GSI for lookups by secondary key.
    const table = new PlatformTable(this, "Table", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      timeToLiveAttribute: "ttl",
    });
    table.addGsi({
      partitionKey: { name: "gsi1pk", type: AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: AttributeType.STRING },
    });
    table.alarms.throttles();
    this.table = table;

    const httpHandler = new PlatformFunction(this, "HttpHandler", {
      entry: lambdaEntry(path.join(__dirname, "..", "..", "app", "src", "handlers", "http")),
      environment: { TABLE_NAME: table.tableName },
    });
    table.grantReadWriteData(httpHandler);
    httpHandler.addStandardAlarms();

    const api = new PlatformHttpApi(this, "Api", {
      cors: true,
    });
    api.addLambdaRoute("/health", HttpMethod.GET, httpHandler);
    api.addLambdaRoute("/items", [HttpMethod.GET, HttpMethod.POST], httpHandler);
    api.addLambdaRoute("/items/{id}", [HttpMethod.GET, HttpMethod.DELETE], httpHandler);
    api.alarms.serverErrors();
    api.alarms.latency();
    this.api = api;
  }
}
