import { CfnOutput, Duration } from "aws-cdk-lib";
import {
  type AddRoutesOptions,
  CorsHttpMethod,
  type CorsPreflightOptions,
  type CfnStage,
  DomainName,
  HttpApi,
  type HttpApiProps,
  HttpMethod,
  type HttpRoute,
  type IHttpRouteAuthorizer,
  type IHttpApi,
} from "aws-cdk-lib/aws-apigatewayv2";
import {
  HttpIamAuthorizer,
  HttpJwtAuthorizer,
  type HttpJwtAuthorizerProps,
  HttpLambdaAuthorizer,
  type HttpLambdaAuthorizerProps,
  HttpLambdaResponseType,
  HttpUserPoolAuthorizer,
  type HttpUserPoolAuthorizerProps,
} from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import {
  HttpLambdaIntegration,
  type HttpLambdaIntegrationProps,
} from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { ComparisonOperator, Stats } from "aws-cdk-lib/aws-cloudwatch";
import type { IUserPool } from "aws-cdk-lib/aws-cognito";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { ARecord, RecordTarget } from "aws-cdk-lib/aws-route53";
import { ApiGatewayv2DomainProperties } from "aws-cdk-lib/aws-route53-targets";
import type { Construct } from "constructs";
import { PlatformAlarm } from "../alerting/alarm";
import { PlatformStack } from "../core/platform-stack";
import { kebab } from "../util/kebab";
import type { FunctionAlarmOptions } from "./function";

export interface PlatformHttpApiThrottle {
  readonly rateLimit: number;
  readonly burstLimit: number;
}

export interface PlatformHttpApiProps extends Omit<
  HttpApiProps,
  "apiName" | "defaultDomainMapping" | "createDefaultStage"
> {
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /**
   * Custom domain. Default: the platform hostname (`{service}.{envDomain}` or the
   * preview pattern) when the environment has a domain. Pass a string to
   * override or `false` to disable.
   */
  readonly domain?: boolean | string;
  /** CORS: `true` allows any origin with common methods and headers. */
  readonly cors?: boolean | CorsPreflightOptions;
  /** Default stage throttling. Default 100 rps / 200 burst. */
  readonly throttle?: PlatformHttpApiThrottle | false;
  /** Write access logs to a platform log group. Default true. */
  readonly accessLogs?: boolean;
  /** Emit `ApiBaseUrl`, `ApiDomainName` and `ApiId` outputs. Default true. */
  readonly outputs?: boolean;
}

export interface LambdaRouteOptions extends Omit<
  AddRoutesOptions,
  "path" | "methods" | "integration"
> {
  readonly integration?: HttpLambdaIntegrationProps;
}

/** Access log format covering the fields needed for latency and error analysis. */
export const HTTP_API_ACCESS_LOG_FORMAT = JSON.stringify({
  requestId: "$context.requestId",
  ip: "$context.identity.sourceIp",
  requestTime: "$context.requestTime",
  httpMethod: "$context.httpMethod",
  routeKey: "$context.routeKey",
  path: "$context.path",
  status: "$context.status",
  protocol: "$context.protocol",
  responseLength: "$context.responseLength",
  responseLatency: "$context.responseLatency",
  integrationLatency: "$context.integrationLatency",
  integrationStatus: "$context.integrationStatus",
  integrationError: "$context.integrationErrorMessage",
  errorMessage: "$context.error.message",
  userAgent: "$context.identity.userAgent",
  authorizerError: "$context.authorizer.error",
  principalId: "$context.authorizer.principalId",
  jwtSub: "$context.authorizer.claims.sub",
});

/** Factories for the supported HTTP API authorizers. */
export const PlatformHttpAuthorizers = {
  /** Generic JWT authorizer. */
  jwt: (
    id: string,
    issuer: string,
    audience: string[],
    props: Partial<HttpJwtAuthorizerProps> = {},
  ): HttpJwtAuthorizer => new HttpJwtAuthorizer(id, issuer, { jwtAudience: audience, ...props }),
  /** Auth0 tenant, e.g. `example.eu.auth0.com`, and the API identifier used as audience. */
  auth0: (
    domain: string,
    audience: string,
    props: Partial<HttpJwtAuthorizerProps> = {},
  ): HttpJwtAuthorizer =>
    new HttpJwtAuthorizer("Auth0Authorizer", `https://${domain.replace(/\/+$/, "")}/`, {
      jwtAudience: [audience],
      ...props,
    }),
  /** Cognito user pool with one or more app clients. */
  cognito: (userPool: IUserPool, props: HttpUserPoolAuthorizerProps = {}): HttpUserPoolAuthorizer =>
    new HttpUserPoolAuthorizer("CognitoAuthorizer", userPool, props),
  /** Custom Lambda authorizer (simple responses by default). */
  lambda: (fn: IFunction, props: HttpLambdaAuthorizerProps = {}): HttpLambdaAuthorizer =>
    new HttpLambdaAuthorizer("LambdaAuthorizer", fn, {
      resultsCacheTtl: Duration.minutes(5),
      responseTypes: [HttpLambdaResponseType.SIMPLE],
      ...props,
    }),
  /** AWS IAM (SigV4) authorization. */
  iam: (): HttpIamAuthorizer => new HttpIamAuthorizer(),
};

/**
 * API Gateway HTTP API with access logs, throttling, optional CORS, a custom
 * domain from the platform naming and SSM contract, Route 53 alias, Lambda
 * route helper and standard alarms.
 */
export class PlatformHttpApi extends HttpApi {
  readonly shortName: string;
  readonly customDomain: DomainName | undefined;
  /** Public base URL without trailing slash. */
  readonly baseUrl: string;
  readonly accessLogGroup: LogGroup | undefined;
  readonly alarms: {
    /** Alarm on 5XX responses. */
    serverErrors: (options?: FunctionAlarmOptions) => PlatformAlarm;
    /** Alarm on a high rate of 4XX responses. */
    clientErrors: (options?: FunctionAlarmOptions) => PlatformAlarm;
    /** Alarm on p99 latency (default 3000ms). */
    latency: (options?: FunctionAlarmOptions) => PlatformAlarm;
  };

  constructor(scope: Construct, id: string, props: PlatformHttpApiProps = {}) {
    const stack = PlatformStack.of(scope);
    const { name, domain, cors, throttle, accessLogs, outputs, ...apiProps } = props;
    const shortName = name ?? kebab(id);

    const hostname =
      domain === false ? undefined : typeof domain === "string" ? domain : stack.naming.domain();
    let customDomain: DomainName | undefined;
    if (hostname) {
      customDomain = new DomainName(scope, `${id}Domain`, {
        domainName: hostname,
        certificate: stack.params.env.certificate(),
      });
    }

    const corsPreflight: CorsPreflightOptions | undefined =
      cors === true
        ? {
            allowOrigins: ["*"],
            allowMethods: [CorsHttpMethod.ANY],
            allowHeaders: ["authorization", "content-type", "x-request-id", "x-correlation-id"],
            maxAge: Duration.hours(1),
          }
        : cors === false || cors === undefined
          ? undefined
          : cors;

    super(scope, id, {
      ...apiProps,
      apiName: stack.naming.resource("apiName", shortName),
      description:
        apiProps.description ?? `${stack.config.service} ${shortName} (${stack.envName})`,
      createDefaultStage: true,
      ...(corsPreflight ? { corsPreflight } : {}),
      ...(customDomain ? { defaultDomainMapping: { domainName: customDomain } } : {}),
    });

    this.shortName = shortName;
    this.customDomain = customDomain;

    const stage = this.defaultStage?.node.defaultChild as CfnStage | undefined;
    if (stage) {
      const rate =
        throttle === false ? undefined : (throttle ?? { rateLimit: 100, burstLimit: 200 });
      stage.defaultRouteSettings = {
        detailedMetricsEnabled: true,
        ...(rate
          ? { throttlingRateLimit: rate.rateLimit, throttlingBurstLimit: rate.burstLimit }
          : {}),
      };
      if (accessLogs ?? true) {
        this.accessLogGroup = new LogGroup(scope, `${id}AccessLogs`, {
          logGroupName: stack.naming.resource(
            "logGroup",
            `/platform/apigateway/${stack.naming.resource("apiName", shortName)}`,
            {
              bare: true,
            },
          ),
          retention: stack.logRetention,
          removalPolicy: stack.removalPolicy,
        });
        stage.accessLogSettings = {
          destinationArn: this.accessLogGroup.logGroupArn,
          format: HTTP_API_ACCESS_LOG_FORMAT,
        };
      }
    }

    if (customDomain && hostname) {
      new ARecord(scope, `${id}AliasRecord`, {
        zone: stack.params.env.hostedZone(),
        recordName: hostname,
        target: RecordTarget.fromAlias(
          new ApiGatewayv2DomainProperties(
            customDomain.regionalDomainName,
            customDomain.regionalHostedZoneId,
          ),
        ),
      });
    }

    this.baseUrl = hostname ? `https://${hostname}` : this.apiEndpoint;

    if (outputs ?? true) {
      new CfnOutput(scope, `${id}BaseUrl`, {
        key: `${pascal(shortName)}BaseUrl`,
        value: this.baseUrl,
      });
      new CfnOutput(scope, `${id}Id`, { key: `${pascal(shortName)}Id`, value: this.apiId });
      if (hostname) {
        new CfnOutput(scope, `${id}DomainName`, {
          key: `${pascal(shortName)}DomainName`,
          value: hostname,
        });
      }
    }

    this.alarms = {
      serverErrors: (options = {}) =>
        new PlatformAlarm(this, "ServerErrorsAlarm", {
          name: options.name ?? `${shortName}-5xx`,
          severity: options.severity ?? "high",
          metric: this.metricServerError({
            period: Duration.minutes(5),
            statistic: Stats.SUM,
            ...options.metricOptions,
          }),
          threshold: options.threshold ?? 1,
          evaluationPeriods: options.evaluationPeriods ?? 1,
          comparisonOperator:
            options.comparisonOperator ?? ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        }),
      clientErrors: (options = {}) =>
        new PlatformAlarm(this, "ClientErrorsAlarm", {
          name: options.name ?? `${shortName}-4xx`,
          severity: options.severity ?? "low",
          metric: this.metricClientError({
            period: Duration.minutes(5),
            statistic: Stats.SUM,
            ...options.metricOptions,
          }),
          threshold: options.threshold ?? 50,
          evaluationPeriods: options.evaluationPeriods ?? 3,
          comparisonOperator:
            options.comparisonOperator ?? ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
      latency: (options = {}) =>
        new PlatformAlarm(this, "LatencyAlarm", {
          name: options.name ?? `${shortName}-latency`,
          severity: options.severity ?? "medium",
          metric: this.metricLatency({
            period: Duration.minutes(5),
            statistic: Stats.percentile(99),
            ...options.metricOptions,
          }),
          threshold: options.threshold ?? 3000,
          evaluationPeriods: options.evaluationPeriods ?? 3,
          comparisonOperator:
            options.comparisonOperator ?? ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
    };
  }

  /** Route one or more methods on a path to a Lambda function. */
  addLambdaRoute(
    path: string,
    methods: HttpMethod | HttpMethod[],
    fn: IFunction,
    options: LambdaRouteOptions = {},
  ): HttpRoute[] {
    const { integration, ...routeOptions } = options;
    const methodList = Array.isArray(methods) ? methods : [methods];
    const integrationId = `${kebab(fn.node.id)}-${kebab(path) || "root"}`;
    return this.addRoutes({
      ...routeOptions,
      path,
      methods: methodList,
      integration: new HttpLambdaIntegration(`Int-${integrationId}`, fn, integration),
    });
  }

  /** Route every method on `path` and `path/{proxy+}` to a single function (for frameworks with their own router). */
  addLambdaProxy(fn: IFunction, basePath = "/", options: LambdaRouteOptions = {}): HttpRoute[] {
    const base = basePath.replace(/\/+$/, "");
    const routes = this.addLambdaRoute(base.length > 0 ? base : "/", [HttpMethod.ANY], fn, options);
    return [...routes, ...this.addLambdaRoute(`${base}/{proxy+}`, [HttpMethod.ANY], fn, options)];
  }

  /** Full URL for a path on this API. */
  urlFor(path: string): string {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }
}

export type { IHttpApi, IHttpRouteAuthorizer };

const pascal = (value: string): string =>
  value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
