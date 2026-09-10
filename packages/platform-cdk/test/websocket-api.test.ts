import { Match, Template } from "aws-cdk-lib/assertions";
import { WebSocketIamAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { PlatformFunction } from "../src/constructs/function";
import { PlatformWebSocketApi } from "../src/constructs/websocket-api";
import { HANDLER_ENTRY, previewStack, testStack } from "./fixtures";

describe("PlatformWebSocketApi", () => {
  it("wires route handlers, stage, logs, permissions and outputs", () => {
    const stack = testStack();
    const connect = new PlatformFunction(stack, "Connect", { entry: HANDLER_ENTRY });
    const message = new PlatformFunction(stack, "Message", { entry: HANDLER_ENTRY });
    const api = new PlatformWebSocketApi(stack, "Ws", {
      connectHandler: connect,
      connectAuthorizer: new WebSocketIamAuthorizer(),
      disconnectHandler: connect,
      defaultHandler: message,
      routes: { sendMessage: message },
    });
    api.grantManageConnections(message);
    api.alarms.serverErrors();

    expect(api.url).toContain("${Token[");
    expect(api.callbackUrl).toContain("${Token[");
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      Name: "orders-ws",
      ProtocolType: "WEBSOCKET",
      RouteSelectionExpression: "$request.body.action",
    });
    for (const routeKey of ["$connect", "$disconnect", "$default", "sendMessage"]) {
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: routeKey });
    }
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "$connect",
      AuthorizationType: "AWS_IAM",
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      StageName: "dev",
      AutoDeploy: true,
      DefaultRouteSettings: Match.objectLike({
        DetailedMetricsEnabled: true,
        ThrottlingRateLimit: 100,
        ThrottlingBurstLimit: 200,
      }),
      AccessLogSettings: {
        DestinationArn: Match.anyValue(),
        Format: Match.stringLikeRegexp("connectionId"),
      },
    });
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([Match.objectLike({ Action: "execute-api:ManageConnections" })]),
      }),
    });
    template.hasOutput("WsUrl", {});
    template.hasOutput("WsId", {});
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-ws-server-errors",
      Metrics: Match.arrayWith([
        Match.objectLike({ Expression: "integrationErrors + executionErrors" }),
      ]),
    });
    expect(api.dashboardWidgets()).toHaveLength(2);
  });

  it("creates a custom domain with the -ws pattern", () => {
    const stack = previewStack();
    const fn = new PlatformFunction(stack, "Handler", { entry: HANDLER_ENTRY });
    const api = new PlatformWebSocketApi(stack, "Ws", {
      defaultHandler: fn,
      domain: true,
      accessLogs: false,
      throttle: false,
    });
    expect(api.url).toBe("wss://orders-ws-abc-123.dev.example.com");
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::ApiGatewayV2::DomainName", {
      DomainName: "orders-ws-abc-123.dev.example.com",
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::ApiMapping", { Stage: "dev" });
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Name: "orders-ws-abc-123.dev.example.com.",
      Type: "A",
    });
    template.hasOutput("WsUrl", { Value: "wss://orders-ws-abc-123.dev.example.com" });

    const base = testStack();
    new PlatformWebSocketApi(base, "Ws", { domain: true, outputs: false });
    Template.fromStack(base).hasResourceProperties("AWS::ApiGatewayV2::DomainName", {
      DomainName: "orders-ws.dev.example.com",
    });
  });
});
