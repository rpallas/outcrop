import { CfnOutput, Duration } from "aws-cdk-lib";
import {
  AccessLogFormat,
  type ApiKeyOptions,
  EndpointType,
  type IApiKey,
  LambdaIntegration,
  type LambdaIntegrationOptions,
  LogGroupLogDestination,
  type Method,
  MethodLoggingLevel,
  type MethodOptions,
  type QuotaSettings,
  type RequestValidator,
  RestApi,
  type RestApiProps,
  SecurityPolicy,
  type StageOptions,
  type ThrottleSettings,
  type UsagePlan,
  type UsagePlanProps,
} from "aws-cdk-lib/aws-apigateway";
import type { HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { ComparisonOperator, type IWidget, Stats } from "aws-cdk-lib/aws-cloudwatch";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { ARecord, RecordTarget } from "aws-cdk-lib/aws-route53";
import { ApiGatewayDomain } from "aws-cdk-lib/aws-route53-targets";
import type { Construct } from "constructs";
import { type PlatformAlarm, type PlatformAlarmOptions, standardAlarm } from "../alerting/alarm";
import { type DashboardContributor, metricWidgets } from "../alerting/service-dashboard";
import { PlatformStack } from "../core/platform-stack";
import { ResourceKind } from "../naming/resource-kind";
import { kebab } from "../util/kebab";
import { pascal } from "../util/pascal";
import type { PlatformHttpApiThrottle } from "./http-api";
import type { PlatformWebAcl } from "./web-acl";

export interface PlatformRestApiProps extends Omit<
  RestApiProps,
  "restApiName" | "domainName" | "deploy" | "deployOptions" | "endpointTypes"
> {
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /**
   * Custom domain. Default: the platform hostname (`{service}.{envDomain}` or the
   * preview pattern) when the environment has a domain. Pass a string to
   * override or `false` to disable.
   */
  readonly domain?: boolean | string;
  /** Stage throttling. Default 100 rps / 200 burst. */
  readonly throttle?: PlatformHttpApiThrottle | false;
  /** Write JSON access logs to a platform log group. Default true. */
  readonly accessLogs?: boolean;
  /** Execution log level. Default ERROR (INFO in previews). */
  readonly loggingLevel?: MethodLoggingLevel;
  /** Extra stage options merged over the platform defaults. */
  readonly stageOptions?: Omit<
    StageOptions,
    | "stageName"
    | "accessLogDestination"
    | "accessLogFormat"
    | "throttlingRateLimit"
    | "throttlingBurstLimit"
  >;
  /** Associate a REGIONAL `PlatformWebAcl` with the stage. */
  readonly webAcl?: PlatformWebAcl;
  /** Emit `<Name>BaseUrl`, `<Name>Id` and `<Name>DomainName` outputs. Default true. */
  readonly outputs?: boolean;
}

export interface RestLambdaRouteOptions extends MethodOptions {
  /** Options for the Lambda proxy integration. */
  readonly integration?: LambdaIntegrationOptions;
}

export interface RestValidatorOptions {
  /** Validate the request body against the method's model. Default true. */
  readonly body?: boolean;
  /** Validate query string parameters and headers. Default true. */
  readonly parameters?: boolean;
}

export interface PlatformUsagePlanOptions {
  /** Short name; defaults to `default`. */
  readonly name?: string;
  readonly throttle?: ThrottleSettings;
  readonly quota?: QuotaSettings;
  /** API keys to attach. */
  readonly apiKeys?: IApiKey[];
}

/**
 * API Gateway REST API with JSON access logs, X-Ray, a stage named after the
 * environment, throttling, a custom domain from the platform naming and SSM
 * contract, request validator / API key / usage plan helpers and alarms.
 */
export class PlatformRestApi extends RestApi implements DashboardContributor {
  readonly shortName: string;
  /** Custom hostname when a domain is configured. */
  readonly hostname: string | undefined;
  /** Public base URL without trailing slash. */
  readonly baseUrl: string;
  readonly accessLogGroup: LogGroup | undefined;
  readonly alarms: {
    /** Alarm on 5XX responses. */
    serverErrors: (options?: PlatformAlarmOptions) => PlatformAlarm;
    /** Alarm on a high rate of 4XX responses. */
    clientErrors: (options?: PlatformAlarmOptions) => PlatformAlarm;
    /** Alarm on p99 latency (default 3000ms). */
    latency: (options?: PlatformAlarmOptions) => PlatformAlarm;
  };

  constructor(scope: Construct, id: string, props: PlatformRestApiProps = {}) {
    const stack = PlatformStack.of(scope);
    const {
      name,
      domain,
      throttle,
      accessLogs,
      loggingLevel,
      stageOptions,
      webAcl,
      outputs,
      ...apiProps
    } = props;
    const shortName = name ?? kebab(id);
    const apiName = stack.naming.resource(ResourceKind.ApiName, shortName);
    const hostname =
      domain === false ? undefined : typeof domain === "string" ? domain : stack.naming.domain();

    let accessLogGroup: LogGroup | undefined;
    if (accessLogs ?? true) {
      accessLogGroup = new LogGroup(scope, `${id}AccessLogs`, {
        logGroupName: stack.naming.resource(
          ResourceKind.LogGroup,
          `/platform/apigateway/${apiName}`,
          { bare: true },
        ),
        retention: stack.logRetention,
        removalPolicy: stack.removalPolicy,
      });
    }
    const rate = throttle === false ? undefined : (throttle ?? { rateLimit: 100, burstLimit: 200 });

    super(scope, id, {
      description: `${stack.config.service} ${shortName} (${stack.envName})`,
      cloudWatchRole: true,
      ...apiProps,
      restApiName: apiName,
      endpointTypes: [EndpointType.REGIONAL],
      deploy: true,
      deployOptions: {
        tracingEnabled: true,
        metricsEnabled: true,
        loggingLevel:
          loggingLevel ?? (stack.isPreview ? MethodLoggingLevel.INFO : MethodLoggingLevel.ERROR),
        dataTraceEnabled: false,
        ...stageOptions,
        stageName: stack.envName,
        ...(accessLogGroup
          ? {
              accessLogDestination: new LogGroupLogDestination(accessLogGroup),
              accessLogFormat: AccessLogFormat.jsonWithStandardFields({
                caller: true,
                httpMethod: true,
                ip: true,
                protocol: true,
                requestTime: true,
                resourcePath: true,
                responseLength: true,
                status: true,
                user: true,
              }),
            }
          : {}),
        ...(rate
          ? { throttlingRateLimit: rate.rateLimit, throttlingBurstLimit: rate.burstLimit }
          : {}),
      },
      ...(hostname
        ? {
            domainName: {
              domainName: hostname,
              certificate: stack.params.env.certificate(),
              endpointType: EndpointType.REGIONAL,
              securityPolicy: SecurityPolicy.TLS_1_2,
            },
          }
        : {}),
    });
    this.shortName = shortName;
    this.hostname = hostname;
    this.accessLogGroup = accessLogGroup;
    // RestApi adds its own `Endpoint` output; the platform emits `<Name>BaseUrl` instead.
    this.node.tryRemoveChild("Endpoint");

    if (hostname && this.domainName) {
      new ARecord(scope, `${id}AliasRecord`, {
        zone: stack.params.env.hostedZone(),
        recordName: hostname,
        target: RecordTarget.fromAlias(new ApiGatewayDomain(this.domainName)),
      });
    }
    this.baseUrl = hostname
      ? `https://${hostname}`
      : `https://${this.restApiId}.execute-api.${stack.region}.${stack.urlSuffix}/${stack.envName}`;

    webAcl?.associate(this.deploymentStage);

    if (outputs ?? true) {
      new CfnOutput(scope, `${id}BaseUrl`, {
        key: `${pascal(shortName)}BaseUrl`,
        value: this.baseUrl,
      });
      new CfnOutput(scope, `${id}Id`, { key: `${pascal(shortName)}Id`, value: this.restApiId });
      if (hostname) {
        new CfnOutput(scope, `${id}DomainName`, {
          key: `${pascal(shortName)}DomainName`,
          value: hostname,
        });
      }
    }

    this.alarms = {
      serverErrors: (options = {}) =>
        standardAlarm(this, "ServerErrorsAlarm", options, {
          name: `${shortName}-5xx`,
          severity: "high",
          metric: this.metricServerError({
            period: Duration.minutes(5),
            statistic: Stats.SUM,
            ...options.metricOptions,
          }),
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        }),
      clientErrors: (options = {}) =>
        standardAlarm(this, "ClientErrorsAlarm", options, {
          name: `${shortName}-4xx`,
          severity: "low",
          metric: this.metricClientError({
            period: Duration.minutes(5),
            statistic: Stats.SUM,
            ...options.metricOptions,
          }),
          threshold: 50,
          evaluationPeriods: 3,
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
      latency: (options = {}) =>
        standardAlarm(this, "LatencyAlarm", options, {
          name: `${shortName}-latency`,
          severity: "medium",
          metric: this.metricLatency({
            period: Duration.minutes(5),
            statistic: Stats.percentile(99),
            ...options.metricOptions,
          }),
          threshold: 3000,
          evaluationPeriods: 3,
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
    };
  }

  /**
   * Route one or more methods on a path to a Lambda function (proxy
   * integration), creating intermediate resources as needed.
   */
  addLambdaRoute(
    path: string,
    methods: HttpMethod | HttpMethod[],
    fn: IFunction,
    options: RestLambdaRouteOptions = {},
  ): Method[] {
    const { integration, ...methodOptions } = options;
    const resource = this.root.resourceForPath(path);
    const lambdaIntegration = new LambdaIntegration(fn, integration);
    const methodList = Array.isArray(methods) ? methods : [methods];
    return methodList.map((method) => resource.addMethod(method, lambdaIntegration, methodOptions));
  }

  /** Create a request validator; pass it to routes via `requestValidator`. */
  addValidator(name: string, options: RestValidatorOptions = {}): RequestValidator {
    return this.addRequestValidator(`${pascal(name)}Validator`, {
      requestValidatorName: `${this.shortName}-${kebab(name)}`,
      validateRequestBody: options.body ?? true,
      validateRequestParameters: options.parameters ?? true,
    });
  }

  /** Create an API key named through the platform naming (unless `apiKeyName` is given). */
  override addApiKey(id: string, options: ApiKeyOptions = {}): IApiKey {
    const stack = PlatformStack.of(this);
    return super.addApiKey(id, {
      apiKeyName: stack.naming.resource(ResourceKind.Generic, `${this.shortName}-${kebab(id)}`),
      ...options,
    });
  }

  /**
   * Create a usage plan bound to the deployment stage. Accepts the platform
   * options object or the base `(id, props)` signature.
   */
  override addUsagePlan(
    idOrOptions: string | PlatformUsagePlanOptions = {},
    props: UsagePlanProps = {},
  ): UsagePlan {
    if (typeof idOrOptions === "string") return super.addUsagePlan(idOrOptions, props);
    const stack = PlatformStack.of(this);
    const name = idOrOptions.name ?? "default";
    const plan = super.addUsagePlan(`${pascal(name)}UsagePlan`, {
      name: stack.naming.resource(ResourceKind.Generic, `${this.shortName}-${kebab(name)}`),
      ...(idOrOptions.throttle ? { throttle: idOrOptions.throttle } : {}),
      ...(idOrOptions.quota ? { quota: idOrOptions.quota } : {}),
      apiStages: [{ stage: this.deploymentStage }],
    });
    for (const key of idOrOptions.apiKeys ?? []) plan.addApiKey(key);
    return plan;
  }

  /** Full URL for a path on this API. */
  urlFor(path: string): string {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  /** Widgets for `serviceDashboard`. */
  dashboardWidgets(): IWidget[] {
    return metricWidgets([
      {
        title: `REST API ${this.shortName}: requests`,
        left: [this.metricCount()],
        right: [this.metricClientError(), this.metricServerError()],
      },
      {
        title: `REST API ${this.shortName}: latency`,
        left: [
          this.metricLatency({ statistic: Stats.percentile(50) }),
          this.metricLatency({ statistic: Stats.percentile(99) }),
        ],
      },
    ]);
  }
}
