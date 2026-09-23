import { CfnOutput, Duration } from "aws-cdk-lib";
import { AccessLogFormat } from "aws-cdk-lib/aws-apigateway";
import {
  DomainName,
  type IWebSocketRouteAuthorizer,
  LogGroupLogDestination,
  type ThrottleSettings,
  WebSocketApi,
  type WebSocketApiProps,
  type WebSocketRouteOptions,
  WebSocketStage,
} from "aws-cdk-lib/aws-apigatewayv2";
import { WebSocketLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import {
  ComparisonOperator,
  type IWidget,
  MathExpression,
  type Metric,
  type MetricOptions,
  Stats,
} from "aws-cdk-lib/aws-cloudwatch";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { ARecord, RecordTarget } from "aws-cdk-lib/aws-route53";
import { ApiGatewayv2DomainProperties } from "aws-cdk-lib/aws-route53-targets";
import type { Construct } from "constructs";
import { type PlatformAlarm, type PlatformAlarmOptions, standardAlarm } from "../alerting/alarm";
import { type DashboardContributor, metricWidgets } from "../alerting/service-dashboard";
import { PlatformStack } from "../core/platform-stack";
import { ResourceKind } from "../naming/resource-kind";
import { kebab } from "../util/kebab";
import { pascal } from "../util/pascal";

export interface PlatformWebSocketApiProps extends Omit<
  WebSocketApiProps,
  "apiName" | "connectRouteOptions" | "disconnectRouteOptions" | "defaultRouteOptions"
> {
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /** Handler for the `$connect` route. */
  readonly connectHandler?: IFunction;
  /** Authorizer for the `$connect` route (the only route WebSocket APIs can authorize). */
  readonly connectAuthorizer?: IWebSocketRouteAuthorizer;
  /** Handler for the `$disconnect` route. */
  readonly disconnectHandler?: IFunction;
  /** Handler for the `$default` route. */
  readonly defaultHandler?: IFunction;
  /** Custom routes keyed by route key (matched against `routeSelectionExpression`, default `$request.body.action`). */
  readonly routes?: Record<string, IFunction>;
  /**
   * Custom domain. `true` uses `{service}-ws.{envDomain}` (preview pattern with
   * `-ws` appended to the service), a string sets the hostname. Default: none.
   */
  readonly domain?: boolean | string;
  /** Stage throttling. Default 100 rps / 200 burst. */
  readonly throttle?: ThrottleSettings | false;
  /** Write access logs to a platform log group. Default true. */
  readonly accessLogs?: boolean;
  /** Emit `<Name>Url` and `<Name>Id` outputs. Default true. */
  readonly outputs?: boolean;
}

/** Access log format for WebSocket stages. */
export const WEBSOCKET_ACCESS_LOG_FORMAT = JSON.stringify({
  requestId: "$context.requestId",
  connectionId: "$context.connectionId",
  eventType: "$context.eventType",
  routeKey: "$context.routeKey",
  ip: "$context.identity.sourceIp",
  requestTime: "$context.requestTime",
  status: "$context.status",
  integrationLatency: "$context.integrationLatency",
  integrationStatus: "$context.integration.status",
  errorMessage: "$context.error.message",
  authorizerError: "$context.authorizer.error",
  principalId: "$context.authorizer.principalId",
});

/**
 * API Gateway WebSocket API with Lambda integrations for the standard and
 * custom routes, a stage named after the environment, access logs, optional
 * custom domain and alarms. Use `grantManageConnections(fn)` for handlers that
 * post messages back to clients.
 */
export class PlatformWebSocketApi extends WebSocketApi implements DashboardContributor {
  readonly shortName: string;
  readonly stage: WebSocketStage;
  readonly customDomain: DomainName | undefined;
  /** Custom hostname when a domain is configured. */
  readonly hostname: string | undefined;
  /** `wss://` URL clients connect to. */
  readonly url: string;
  /** HTTPS URL for the connection management API (`@connections`). */
  readonly callbackUrl: string;
  readonly accessLogGroup: LogGroup | undefined;
  readonly alarms: {
    /** Alarm on integration and execution errors. */
    serverErrors: (options?: PlatformAlarmOptions) => PlatformAlarm;
  };

  constructor(scope: Construct, id: string, props: PlatformWebSocketApiProps = {}) {
    const stack = PlatformStack.of(scope);
    const {
      name,
      connectHandler,
      connectAuthorizer,
      disconnectHandler,
      defaultHandler,
      routes,
      domain,
      throttle,
      accessLogs,
      outputs,
      ...apiProps
    } = props;
    const shortName = name ?? kebab(id);
    const routeOptions = (routeKey: string, fn: IFunction): WebSocketRouteOptions => ({
      integration: new WebSocketLambdaIntegration(`${pascal(routeKey)}Integration`, fn),
    });

    super(scope, id, {
      description: `${stack.config.service} ${shortName} (${stack.envName})`,
      ...apiProps,
      apiName: stack.naming.resource(ResourceKind.ApiName, shortName),
      ...(connectHandler
        ? {
            connectRouteOptions: {
              ...routeOptions("connect", connectHandler),
              ...(connectAuthorizer ? { authorizer: connectAuthorizer } : {}),
            },
          }
        : {}),
      ...(disconnectHandler
        ? { disconnectRouteOptions: routeOptions("disconnect", disconnectHandler) }
        : {}),
      ...(defaultHandler ? { defaultRouteOptions: routeOptions("default", defaultHandler) } : {}),
    });
    this.shortName = shortName;
    for (const [routeKey, fn] of Object.entries(routes ?? {})) {
      this.addRoute(routeKey, routeOptions(routeKey, fn));
    }

    const hostname =
      domain === true
        ? stack.naming.domain(
            stack.isPreview
              ? stack.naming.domainPattern.replace("{service}", "{service}-ws")
              : "{service}-ws.{envDomain}",
          )
        : typeof domain === "string"
          ? domain
          : undefined;
    if (hostname) {
      this.customDomain = new DomainName(scope, `${id}Domain`, {
        domainName: hostname,
        certificate: stack.params.env.certificate(),
      });
    }
    this.hostname = hostname;

    if (accessLogs ?? true) {
      this.accessLogGroup = new LogGroup(scope, `${id}AccessLogs`, {
        logGroupName: stack.naming.resource(
          ResourceKind.LogGroup,
          `/platform/apigateway/${stack.naming.resource(ResourceKind.ApiName, shortName)}`,
          { bare: true },
        ),
        retention: stack.logRetention,
        removalPolicy: stack.removalPolicy,
      });
    }
    const rate = throttle === false ? undefined : (throttle ?? { rateLimit: 100, burstLimit: 200 });

    this.stage = new WebSocketStage(scope, `${id}Stage`, {
      webSocketApi: this,
      stageName: stack.envName,
      autoDeploy: true,
      detailedMetricsEnabled: true,
      ...(rate ? { throttle: rate } : {}),
      ...(this.customDomain ? { domainMapping: { domainName: this.customDomain } } : {}),
      ...(this.accessLogGroup
        ? {
            accessLogSettings: {
              destination: new LogGroupLogDestination(this.accessLogGroup),
              format: AccessLogFormat.custom(WEBSOCKET_ACCESS_LOG_FORMAT),
            },
          }
        : {}),
    });

    if (this.customDomain && hostname) {
      new ARecord(scope, `${id}AliasRecord`, {
        zone: stack.params.env.hostedZone(),
        recordName: hostname,
        target: RecordTarget.fromAlias(
          new ApiGatewayv2DomainProperties(
            this.customDomain.regionalDomainName,
            this.customDomain.regionalHostedZoneId,
          ),
        ),
      });
    }

    this.url = hostname ? `wss://${hostname}` : this.stage.url;
    this.callbackUrl = this.stage.callbackUrl;

    if (outputs ?? true) {
      new CfnOutput(scope, `${id}Url`, { key: `${pascal(shortName)}Url`, value: this.url });
      new CfnOutput(scope, `${id}Id`, { key: `${pascal(shortName)}Id`, value: this.apiId });
    }

    this.alarms = {
      serverErrors: (options = {}) =>
        standardAlarm(this, "ServerErrorsAlarm", options, {
          name: `${shortName}-server-errors`,
          severity: "high",
          metric: new MathExpression({
            expression: "integrationErrors + executionErrors",
            label: "Server errors",
            usingMetrics: {
              integrationErrors: this.stageMetric("IntegrationError", options.metricOptions),
              executionErrors: this.stageMetric("ExecutionError", options.metricOptions),
            },
            period: options.metricOptions?.period ?? Duration.minutes(5),
          }),
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        }),
    };
  }

  /** Stage metric (`ConnectCount`, `MessageCount`, `IntegrationError`, `ExecutionError`, `ClientError`, ...). */
  stageMetric(metricName: string, options: MetricOptions = {}): Metric {
    return this.stage.metric(metricName, {
      period: Duration.minutes(5),
      statistic: Stats.SUM,
      ...options,
    });
  }

  /** Widgets for `serviceDashboard`. */
  dashboardWidgets(): IWidget[] {
    return metricWidgets([
      {
        title: `WebSocket ${this.shortName}: traffic`,
        left: [this.stageMetric("ConnectCount"), this.stageMetric("MessageCount")],
      },
      {
        title: `WebSocket ${this.shortName}: errors`,
        left: [
          this.stageMetric("IntegrationError"),
          this.stageMetric("ExecutionError"),
          this.stageMetric("ClientError"),
        ],
      },
    ]);
  }
}
