import { Match, Template } from "aws-cdk-lib/assertions";
import { AuthorizationType, Period } from "aws-cdk-lib/aws-apigateway";
import { HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { PlatformFunction } from "../src/constructs/function";
import { PlatformRestApi } from "../src/constructs/rest-api";
import { HANDLER_ENTRY, previewStack, testConfig, testStack } from "./fixtures";

describe("PlatformRestApi", () => {
  it("creates a REST API with logs, tracing, domain, routes, keys and alarms", () => {
    const stack = testStack();
    const api = new PlatformRestApi(stack, "Api");
    const fn = new PlatformFunction(stack, "Handler", { entry: HANDLER_ENTRY });
    const validator = api.addValidator("body-only", { parameters: false });
    api.addLambdaRoute("/v1/orders/{id}", [HttpMethod.GET, HttpMethod.PUT], fn, {
      apiKeyRequired: true,
      requestValidator: validator,
    });
    api.addLambdaRoute("/health", HttpMethod.GET, fn, {
      authorizationType: AuthorizationType.IAM,
    });
    const key = api.addApiKey("Partner");
    api.addUsagePlan({
      throttle: { rateLimit: 10, burstLimit: 20 },
      quota: { limit: 1000, period: Period.DAY },
      apiKeys: [key],
    });
    api.alarms.serverErrors();
    api.alarms.clientErrors();
    api.alarms.latency({ threshold: 1000 });

    expect(api.baseUrl).toBe("https://orders.dev.example.com");
    expect(api.urlFor("v1/orders/1")).toBe("https://orders.dev.example.com/v1/orders/1");
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::ApiGateway::RestApi", {
      Name: "orders-api",
      EndpointConfiguration: { Types: ["REGIONAL"] },
    });
    template.hasResourceProperties("AWS::ApiGateway::Stage", {
      StageName: "dev",
      TracingEnabled: true,
      AccessLogSetting: {
        DestinationArn: Match.anyValue(),
        Format: Match.stringLikeRegexp("requestId"),
      },
      MethodSettings: [
        Match.objectLike({
          LoggingLevel: "ERROR",
          MetricsEnabled: true,
          ThrottlingRateLimit: 100,
          ThrottlingBurstLimit: 200,
        }),
      ],
    });
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/platform/apigateway/orders-api",
    });
    template.hasResourceProperties("AWS::ApiGateway::DomainName", {
      DomainName: "orders.dev.example.com",
      SecurityPolicy: "TLS_1_2",
      EndpointConfiguration: { Types: ["REGIONAL"] },
    });
    template.resourceCountIs("AWS::ApiGateway::BasePathMapping", 1);
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Name: "orders.dev.example.com.",
      Type: "A",
    });
    template.hasResourceProperties("AWS::ApiGateway::Resource", { PathPart: "{id}" });
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "PUT",
      ApiKeyRequired: true,
      RequestValidatorId: Match.anyValue(),
      Integration: Match.objectLike({ Type: "AWS_PROXY" }),
    });
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "GET",
      AuthorizationType: "AWS_IAM",
    });
    template.hasResourceProperties("AWS::ApiGateway::RequestValidator", {
      Name: "api-body-only",
      ValidateRequestBody: true,
      ValidateRequestParameters: false,
    });
    template.hasResourceProperties("AWS::ApiGateway::ApiKey", { Name: "orders-api-partner" });
    template.hasResourceProperties("AWS::ApiGateway::UsagePlan", {
      UsagePlanName: "orders-api-default",
      Throttle: { RateLimit: 10, BurstLimit: 20 },
      Quota: { Limit: 1000, Period: "DAY" },
      ApiStages: [
        Match.objectLike({ Stage: { Ref: Match.stringLikeRegexp("ApiDeploymentStage") } }),
      ],
    });
    template.resourceCountIs("AWS::ApiGateway::UsagePlanKey", 1);
    template.hasOutput("ApiBaseUrl", { Value: "https://orders.dev.example.com" });
    template.hasOutput("ApiDomainName", {});
    template.hasOutput("ApiId", {});
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-api-5xx",
      MetricName: "5XXError",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-api-latency",
      Threshold: 1000,
    });
    expect(api.dashboardWidgets()).toHaveLength(2);
  });

  it("falls back to the execute-api URL and INFO logs in previews", () => {
    const stack = previewStack();
    const api = new PlatformRestApi(stack, "Api", {
      domain: false,
      throttle: false,
      accessLogs: false,
      stageOptions: { cachingEnabled: false },
    });
    api.root.addMethod("ANY");
    expect(api.baseUrl).toContain("${Token[");
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::ApiGateway::DomainName", 0);
    template.resourceCountIs("AWS::Logs::LogGroup", 0);
    template.hasResourceProperties("AWS::ApiGateway::Stage", {
      StageName: "dev",
      MethodSettings: [Match.objectLike({ LoggingLevel: "INFO" })],
    });
    template.hasOutput("ApiBaseUrl", {
      Value: Match.objectLike({
        "Fn::Join": Match.arrayWith([Match.arrayWith([Match.stringLikeRegexp("/dev")])]),
      }),
    });
  });

  it("supports the base addUsagePlan signature and environments without a domain", () => {
    const stack = testStack({
      config: testConfig({
        environments: { dev: { account: "111111111111", region: "eu-west-1" } },
      }),
    });
    const api = new PlatformRestApi(stack, "Api", { outputs: false });
    api.root.addMethod("GET");
    api.addUsagePlan("Legacy", { name: "legacy", throttle: { rateLimit: 1 } });
    expect(api.hostname).toBeUndefined();
    Template.fromStack(stack).hasResourceProperties("AWS::ApiGateway::UsagePlan", {
      UsagePlanName: "legacy",
    });
  });
});
