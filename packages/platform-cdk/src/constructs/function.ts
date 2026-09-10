import { existsSync } from "node:fs";
import path from "node:path";
import { Duration } from "aws-cdk-lib";
import {
  ComparisonOperator,
  type IWidget,
  type MetricOptions,
  Stats,
} from "aws-cdk-lib/aws-cloudwatch";
import {
  ApplicationLogLevel,
  Architecture,
  Code,
  LambdaInsightsVersion,
  LayerVersion,
  LoggingFormat,
  Runtime,
  SystemLogLevel,
  Tracing,
} from "aws-cdk-lib/aws-lambda";
import {
  NodejsFunction,
  type NodejsFunctionProps,
  OutputFormat,
} from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { type IQueue } from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";
import { PlatformAlarm, type PlatformAlarmProps } from "../alerting/alarm";
import type { DashboardContributor } from "../alerting/service-dashboard";
import { metricWidgets } from "../alerting/service-dashboard";
import type { AlertSeverity } from "../alerting/severity";
import { PlatformStack } from "../core/platform-stack";
import { kebab } from "../util/kebab";
import { PlatformQueue } from "./queue";

export type PlatformLogLevel = "debug" | "info" | "warn" | "error";

export interface PlatformFunctionLogging {
  /** Application log level exported as POWERTOOLS_LOG_LEVEL / LOG_LEVEL. Default info (debug in previews). */
  readonly level?: PlatformLogLevel;
  /**
   * Lambda log format. `text` (default) keeps the raw JSON lines written by the
   * runtime logger; `json` enables Lambda advanced logging controls.
   */
  readonly format?: "text" | "json";
  /**
   * Attach the telemetry layer shipped with `@rpallas/platform-cdk-runtime` so
   * JSON lines are written through the Lambda telemetry file descriptor and
   * rendered as structured records in the console. Default false.
   */
  readonly telemetryLayer?: boolean;
}

export interface PlatformFunctionProps extends Omit<
  NodejsFunctionProps,
  "functionName" | "logGroup" | "deadLetterQueue" | "deadLetterQueueEnabled"
> {
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /** Enable Lambda Insights. Default false. */
  readonly insights?: boolean;
  /** Create a dead letter queue (`true`) or use an existing one. Default: none. */
  readonly deadLetterQueue?: boolean | IQueue;
  /** Logging behaviour and runtime wiring. */
  readonly logging?: PlatformFunctionLogging;
  /** Extra environment variables merged over the platform defaults. */
  readonly environment?: Record<string, string>;
}

export interface FunctionAlarmOptions extends Partial<
  Omit<PlatformAlarmProps, "metric" | "name" | "severity">
> {
  readonly severity?: AlertSeverity;
  readonly name?: string;
  readonly metricOptions?: MetricOptions;
}

/**
 * Resolve a Lambda entry file from a path without extension, preferring
 * TypeScript sources and falling back to compiled JavaScript.
 */
export const lambdaEntry = (pathWithoutExt: string): string => {
  for (const ext of [".ts", ".mts", ".cts", ".mjs", ".cjs", ".js"]) {
    const candidate = `${pathWithoutExt}${ext}`;
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `No Lambda entry found for ${pathWithoutExt} (tried .ts, .mts, .cts, .mjs, .cjs, .js)`,
  );
};

const LOG_LEVEL_MAP: Record<PlatformLogLevel, ApplicationLogLevel> = {
  debug: ApplicationLogLevel.DEBUG,
  info: ApplicationLogLevel.INFO,
  warn: ApplicationLogLevel.WARN,
  error: ApplicationLogLevel.ERROR,
};

const resolveTelemetryLayerPath = (): string | undefined => {
  try {
    const pkg = require.resolve("@rpallas/platform-cdk-runtime/package.json");
    const layerDir = path.join(path.dirname(pkg), "layer");
    return existsSync(layerDir) ? layerDir : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Opinionated `NodejsFunction`: ARM64, current Node LTS, X-Ray, explicit log
 * group with platform retention, source maps, platform environment variables
 * and helpers for the standard alarms.
 */
export class PlatformFunction extends NodejsFunction implements DashboardContributor {
  readonly shortName: string;
  readonly logLevel: PlatformLogLevel;
  readonly dlq: IQueue | undefined;
  readonly alarms: {
    /** Alarm when any invocation errors within the period. */
    errors: (options?: FunctionAlarmOptions) => PlatformAlarm;
    /** Alarm when invocations are throttled. */
    throttles: (options?: FunctionAlarmOptions) => PlatformAlarm;
    /** Alarm when p99 duration approaches the timeout (default 80%). */
    duration: (
      options?: FunctionAlarmOptions & { thresholdPercentOfTimeout?: number },
    ) => PlatformAlarm;
    /** Alarm when messages land in the dead letter queue. */
    deadLetters: (options?: FunctionAlarmOptions) => PlatformAlarm;
  };

  constructor(scope: Construct, id: string, props: PlatformFunctionProps) {
    const stack = PlatformStack.of(scope);
    const { name, insights, deadLetterQueue, logging, environment, ...fnProps } = props;
    const shortName = name ?? kebab(id);
    const functionName = stack.naming.resource("lambdaFunction", shortName);
    const logLevel: PlatformLogLevel = logging?.level ?? (stack.isPreview ? "debug" : "info");
    const runtime = fnProps.runtime ?? Runtime.NODEJS_24_X;
    const timeout = fnProps.timeout ?? Duration.seconds(10);
    const useJsonFormat = logging?.format === "json";

    const logGroup = new LogGroup(scope, `${id}LogGroup`, {
      logGroupName: stack.naming.resource("logGroup", `/aws/lambda/${functionName}`, {
        bare: true,
      }),
      retention: stack.logRetention,
      removalPolicy: stack.removalPolicy,
    });

    let dlq: IQueue | undefined;
    if (deadLetterQueue === true) {
      dlq = new PlatformQueue(scope, `${id}Dlq`, {
        name: `${shortName}-dlq`,
        retentionPeriod: Duration.days(14),
      });
    } else if (deadLetterQueue) {
      dlq = deadLetterQueue;
    }

    super(scope, id, {
      architecture: Architecture.ARM_64,
      memorySize: 1024,
      tracing: Tracing.ACTIVE,
      ...fnProps,
      runtime,
      timeout,
      functionName,
      logGroup,
      ...(useJsonFormat
        ? {
            loggingFormat: LoggingFormat.JSON,
            applicationLogLevelV2: LOG_LEVEL_MAP[logLevel],
            systemLogLevelV2: SystemLogLevel.INFO,
          }
        : { loggingFormat: LoggingFormat.TEXT }),
      ...(insights ? { insightsVersion: LambdaInsightsVersion.VERSION_1_0_333_0 } : {}),
      ...(dlq ? { deadLetterQueue: dlq } : {}),
      bundling: {
        minify: true,
        sourceMap: true,
        sourcesContent: false,
        target: runtimeTarget(runtime),
        format: OutputFormat.CJS,
        mainFields: ["module", "main"],
        ...fnProps.bundling,
      },
      environment: {
        NODE_OPTIONS: "--enable-source-maps",
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
        POWERTOOLS_SERVICE_NAME: stack.config.service,
        POWERTOOLS_LOG_LEVEL: logLevel.toUpperCase(),
        POWERTOOLS_LOGGER_LOG_EVENT: stack.isPreview ? "true" : "false",
        LOG_LEVEL: logLevel,
        PLATFORM_PROJECT: stack.config.project,
        PLATFORM_SERVICE: stack.config.service,
        PLATFORM_ENV: stack.envName,
        PLATFORM_SSM_ROOT: stack.config.ssmRootPrefix,
        PLATFORM_FUNCTION: shortName,
        ...(stack.previewId ? { PLATFORM_PREVIEW_ID: stack.previewId } : {}),
        ...environment,
      },
    });

    this.shortName = shortName;
    this.logLevel = logLevel;
    this.dlq = dlq;

    if (logging?.telemetryLayer) {
      const layerPath = resolveTelemetryLayerPath();
      if (!layerPath) {
        throw new Error(
          "logging.telemetryLayer requires @rpallas/platform-cdk-runtime to be installed (its `layer/` asset is bundled into a Lambda layer).",
        );
      }
      this.addLayers(
        new LayerVersion(scope, `${id}TelemetryLayer`, {
          layerVersionName: stack.naming.resource("lambdaLayer", `${shortName}-telemetry`),
          code: Code.fromAsset(layerPath),
          compatibleArchitectures: [Architecture.ARM_64, Architecture.X86_64],
          compatibleRuntimes: [Runtime.NODEJS_20_X, Runtime.NODEJS_22_X, Runtime.NODEJS_24_X],
          description: "platform-cdk telemetry log hook",
          removalPolicy: stack.removalPolicy,
        }),
      );
      this.addEnvironment(
        "NODE_OPTIONS",
        "--enable-source-maps --require /opt/nodejs/platform-telemetry.js",
      );
      this.addEnvironment("PLATFORM_TELEMETRY_FD", "1");
    }

    this.alarms = {
      errors: (options = {}) =>
        new PlatformAlarm(this, "ErrorsAlarm", {
          name: options.name ?? `${shortName}-errors`,
          severity: options.severity ?? "high",
          metric: this.metricErrors({
            period: Duration.minutes(5),
            statistic: Stats.SUM,
            ...options.metricOptions,
          }),
          threshold: options.threshold ?? 1,
          evaluationPeriods: options.evaluationPeriods ?? 1,
          comparisonOperator:
            options.comparisonOperator ?? ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          ...stripAlarmOptions(options),
        }),
      throttles: (options = {}) =>
        new PlatformAlarm(this, "ThrottlesAlarm", {
          name: options.name ?? `${shortName}-throttles`,
          severity: options.severity ?? "medium",
          metric: this.metricThrottles({
            period: Duration.minutes(5),
            statistic: Stats.SUM,
            ...options.metricOptions,
          }),
          threshold: options.threshold ?? 1,
          evaluationPeriods: options.evaluationPeriods ?? 1,
          comparisonOperator:
            options.comparisonOperator ?? ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          ...stripAlarmOptions(options),
        }),
      duration: (options = {}) => {
        const percent = options.thresholdPercentOfTimeout ?? 80;
        const { thresholdPercentOfTimeout: _ignored, ...rest } = options;
        return new PlatformAlarm(this, "DurationAlarm", {
          name: rest.name ?? `${shortName}-duration`,
          severity: rest.severity ?? "medium",
          metric: this.metricDuration({
            period: Duration.minutes(5),
            statistic: Stats.percentile(99),
            ...rest.metricOptions,
          }),
          threshold: rest.threshold ?? Math.floor((timeout.toMilliseconds() * percent) / 100),
          evaluationPeriods: rest.evaluationPeriods ?? 3,
          comparisonOperator: rest.comparisonOperator ?? ComparisonOperator.GREATER_THAN_THRESHOLD,
          ...stripAlarmOptions(rest),
        });
      },
      deadLetters: (options = {}) => {
        if (!this.dlq) {
          throw new Error(`${this.node.path}: deadLetters alarm requires deadLetterQueue`);
        }
        return new PlatformAlarm(this, "DeadLettersAlarm", {
          name: options.name ?? `${shortName}-dead-letters`,
          severity: options.severity ?? "high",
          metric: this.dlq.metricApproximateNumberOfMessagesVisible({
            period: Duration.minutes(5),
            statistic: Stats.MAXIMUM,
            ...options.metricOptions,
          }),
          threshold: options.threshold ?? 1,
          evaluationPeriods: options.evaluationPeriods ?? 1,
          comparisonOperator:
            options.comparisonOperator ?? ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          ...stripAlarmOptions(options),
        });
      },
    };
  }

  /** Create the standard set of alarms (errors, throttles, duration and dead letters when a DLQ exists). */
  addStandardAlarms(options: FunctionAlarmOptions = {}): PlatformAlarm[] {
    const alarms = [
      this.alarms.errors(options),
      this.alarms.throttles(options),
      this.alarms.duration(options),
    ];
    if (this.dlq) alarms.push(this.alarms.deadLetters(options));
    return alarms;
  }

  /** Widgets for `serviceDashboard`. */
  dashboardWidgets(): IWidget[] {
    return metricWidgets([
      {
        title: `Function ${this.shortName}: invocations`,
        left: [this.metricInvocations()],
        right: [this.metricErrors(), this.metricThrottles()],
      },
      {
        title: `Function ${this.shortName}: duration`,
        left: [
          this.metricDuration({ statistic: Stats.percentile(50) }),
          this.metricDuration({ statistic: Stats.percentile(99) }),
        ],
      },
      {
        title: `Function ${this.shortName}: concurrency`,
        left: [this.metric("ConcurrentExecutions", { statistic: Stats.MAXIMUM })],
        ...(this.dlq ? { right: [this.dlq.metricApproximateNumberOfMessagesVisible()] } : {}),
      },
    ]);
  }
}

const runtimeTarget = (runtime: Runtime): string => {
  const match = /^nodejs(\d+)/.exec(runtime.name);
  return match?.[1] ? `node${match[1]}` : "node24";
};

const stripAlarmOptions = (
  options: FunctionAlarmOptions,
): Partial<
  Omit<
    PlatformAlarmProps,
    "metric" | "name" | "severity" | "threshold" | "evaluationPeriods" | "comparisonOperator"
  >
> => {
  const {
    severity: _severity,
    name: _name,
    metricOptions: _metricOptions,
    threshold: _threshold,
    evaluationPeriods: _evaluationPeriods,
    comparisonOperator: _comparisonOperator,
    ...rest
  } = options;
  return rest;
};
