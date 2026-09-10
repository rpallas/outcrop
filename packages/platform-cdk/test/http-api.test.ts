import { Match, Template } from "aws-cdk-lib/assertions";
import { HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { UserPool } from "aws-cdk-lib/aws-cognito";
import { PlatformFunction } from "../src/constructs/function";
import { PlatformHttpApi, PlatformHttpAuthorizers } from "../src/constructs/http-api";
import { HANDLER_ENTRY, previewStack, testConfig, testStack } from "./fixtures";

describe("PlatformHttpApi", () => {
  it("creates an api with domain, logs, throttling and outputs", () => {
    const stack = testStack();
    const api = new PlatformHttpApi(stack, "Api", { cors: true });
    const fn = new PlatformFunction(stack, "Handler", { entry: HANDLER_ENTRY });
    api.addLambdaRoute("/orders", [HttpMethod.GET, HttpMethod.POST], fn);
    api.alarms.serverErrors();
    api.alarms.clientErrors();
    api.alarms.latency();

    expect(api.baseUrl).toBe("https://orders.dev.example.com");
    expect(api.urlFor("orders")).toBe("https://orders.dev.example.com/orders");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      Name: "orders-api",
      ProtocolType: "HTTP",
      CorsConfiguration: Match.objectLike({ AllowOrigins: ["*"], AllowMethods: ["*"] }),
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      StageName: "$default",
      AutoDeploy: true,
      DefaultRouteSettings: {
        DetailedMetricsEnabled: true,
        ThrottlingRateLimit: 100,
        ThrottlingBurstLimit: 200,
      },
      AccessLogSettings: {
        DestinationArn: Match.anyValue(),
        Format: Match.stringLikeRegexp("requestId"),
      },
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::DomainName", {
      DomainName: "orders.dev.example.com",
      DomainNameConfigurations: [
        Match.objectLike({ CertificateArn: Match.stringLikeRegexp("arn:aws:acm:eu-west-1") }),
      ],
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::ApiMapping", { Stage: "$default" });
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Name: "orders.dev.example.com.",
      Type: "A",
      HostedZoneId: "Z0000000000000000000A",
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "GET /orders" });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "POST /orders" });
    template.resourceCountIs("AWS::ApiGatewayV2::Integration", 1);
    template.hasOutput("ApiBaseUrl", { Value: "https://orders.dev.example.com" });
    template.hasOutput("ApiDomainName", { Value: "orders.dev.example.com" });
    template.hasOutput("ApiId", {});
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-api-5xx",
      MetricName: "5xx",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-api-latency",
      ExtendedStatistic: "p99",
    });
  });

  it("uses the preview hostname", () => {
    const stack = previewStack("abc-123");
    const api = new PlatformHttpApi(stack, "Api");
    expect(api.baseUrl).toBe("https://orders-abc-123.dev.example.com");
    Template.fromStack(stack).hasResourceProperties("AWS::ApiGatewayV2::DomainName", {
      DomainName: "orders-abc-123.dev.example.com",
    });
  });

  it("falls back to the execute-api endpoint without a domain", () => {
    const stack = testStack({
      config: testConfig({
        environments: { dev: { account: "111111111111", region: "eu-west-1" } },
      }),
    });
    const api = new PlatformHttpApi(stack, "Api", { throttle: false, accessLogs: false });
    expect(api.customDomain).toBeUndefined();
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::ApiGatewayV2::DomainName", 0);
    template.resourceCountIs("AWS::Logs::LogGroup", 0);
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      DefaultRouteSettings: { DetailedMetricsEnabled: true },
    });
    template.hasOutput("ApiBaseUrl", {});
    expect(api.baseUrl).toContain("${Token[");
  });

  it("disables the domain explicitly or overrides it", () => {
    const stack = testStack();
    new PlatformHttpApi(stack, "Api", { domain: false, outputs: false });
    new PlatformHttpApi(stack, "Admin", { domain: "admin.dev.example.com", outputs: false });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::ApiGatewayV2::DomainName", 1);
    template.hasResourceProperties("AWS::ApiGatewayV2::DomainName", {
      DomainName: "admin.dev.example.com",
    });
  });

  it("supports authorizers", () => {
    const stack = testStack();
    const fn = new PlatformFunction(stack, "Handler", { entry: HANDLER_ENTRY });
    const authorizerFn = new PlatformFunction(stack, "Authorizer", { entry: HANDLER_ENTRY });
    const pool = new UserPool(stack, "Pool");
    const api = new PlatformHttpApi(stack, "Api", {
      defaultAuthorizer: PlatformHttpAuthorizers.auth0(
        "example.eu.auth0.com",
        "https://api.example.com",
      ),
    });
    api.addLambdaRoute("/me", HttpMethod.GET, fn, { authorizationScopes: ["read:me"] });
    api.addLambdaRoute("/public", HttpMethod.GET, fn, {
      authorizer: PlatformHttpAuthorizers.iam(),
    });
    api.addLambdaRoute("/custom", HttpMethod.GET, fn, {
      authorizer: PlatformHttpAuthorizers.lambda(authorizerFn),
    });
    api.addLambdaRoute("/cognito", HttpMethod.GET, fn, {
      authorizer: PlatformHttpAuthorizers.cognito(pool),
    });
    api.addLambdaRoute("/jwt", HttpMethod.GET, fn, {
      authorizer: PlatformHttpAuthorizers.jwt("Other", "https://issuer.example.com/", ["aud"]),
    });
    api.addLambdaProxy(fn, "/v1");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      AuthorizerType: "JWT",
      JwtConfiguration: {
        Issuer: "https://example.eu.auth0.com/",
        Audience: ["https://api.example.com"],
      },
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      AuthorizerType: "REQUEST",
      AuthorizerPayloadFormatVersion: "2.0",
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /me",
      AuthorizationType: "JWT",
      AuthorizationScopes: ["read:me"],
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /public",
      AuthorizationType: "AWS_IAM",
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /custom",
      AuthorizationType: "CUSTOM",
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "ANY /v1" });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "ANY /v1/{proxy+}" });
  });
});
