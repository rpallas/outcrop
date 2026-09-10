import { existsSync } from "node:fs";
import path from "node:path";
import { type BundlingOptions, type DockerImage, Duration } from "aws-cdk-lib";
import type { IWidget } from "aws-cdk-lib/aws-cloudwatch";
import {
  ApplicationLogLevel,
  Architecture,
  Code,
  Function as LambdaFunction,
  type FunctionProps,
  LambdaInsightsVersion,
  LoggingFormat,
  Runtime,
  SystemLogLevel,
  Tracing,
} from "aws-cdk-lib/aws-lambda";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";
import type { PlatformAlarm } from "../alerting/alarm";
import type { DashboardContributor } from "../alerting/service-dashboard";
import { PlatformStack } from "../core/platform-stack";
import { kebab } from "../util/kebab";
import type { FunctionAlarmOptions, PlatformLogLevel } from "./function";
import {
  createFunctionAlarms,
  type FunctionAlarms,
  functionDashboardWidgets,
} from "./function-alarms";
import { PlatformQueue } from "./queue";

export interface PlatformPythonBundling {
  /**
   * Requirements file relative to `entry`. Default `requirements.txt` when it
   * exists; dependencies are installed with pip inside the Lambda build image.
   */
  readonly requirementsFile?: string;
  /** Extra pip arguments, e.g. `["--no-deps"]`. */
  readonly pipArgs?: string[];
  /** Glob patterns excluded from the asset (tests, caches). */
  readonly exclude?: string[];
  /** Override the build image (default: the runtime's official bundling image). */
  readonly image?: DockerImage;
  /** Environment variables for the build container (e.g. `PIP_INDEX_URL`). */
  readonly environment?: Record<string, string>;
}

export interface PlatformPythonFunctionProps extends Omit<
  FunctionProps,
  | "functionName"
  | "logGroup"
  | "deadLetterQueue"
  | "deadLetterQueueEnabled"
  | "code"
  | "handler"
  | "runtime"
> {
  /** Directory containing the handler module and optional `requirements.txt`. */
  readonly entry: string;
  /** Handler module file inside `entry`. Default `index.py`. */
  readonly index?: string;
  /** Handler function name inside the module. Default `handler`. */
  readonly handler?: string;
  /** Python runtime. Default 3.13. */
  readonly runtime?: Runtime;
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /** Enable Lambda Insights. Default false. */
  readonly insights?: boolean;
  /** Create a dead letter queue (`true`) or use an existing one. Default: none. */
  readonly deadLetterQueue?: boolean | IQueue;
  /** Application log level exported as `LOG_LEVEL` / `POWERTOOLS_LOG_LEVEL`. Default info (debug in previews). */
  readonly logLevel?: PlatformLogLevel;
  /** Bundling behaviour. */
  readonly bundling?: PlatformPythonBundling;
  /** Extra environment variables merged over the platform defaults. */
  readonly environment?: Record<string, string>;
}

const LOG_LEVEL_MAP: Record<PlatformLogLevel, ApplicationLogLevel> = {
  debug: ApplicationLogLevel.DEBUG,
  info: ApplicationLogLevel.INFO,
  warn: ApplicationLogLevel.WARN,
  error: ApplicationLogLevel.ERROR,
};

const DEFAULT_EXCLUDES = [
  "**/__pycache__",
  "**/*.pyc",
  ".venv",
  "venv",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "tests",
];

const pythonBundling = (
  entry: string,
  runtime: Runtime,
  architecture: Architecture,
  options: PlatformPythonBundling,
): BundlingOptions => {
  const requirements = options.requirementsFile ?? "requirements.txt";
  const hasRequirements = existsSync(path.join(entry, requirements));
  const pipArgs = (options.pipArgs ?? []).join(" ");
  const platform =
    architecture === Architecture.ARM_64 ? "manylinux2014_aarch64" : "manylinux2014_x86_64";
  const install = hasRequirements
    ? `python -m pip install -r ${requirements} -t /asset-output --platform ${platform} --only-binary=:all: --implementation cp ${pipArgs} && `
    : "";
  return {
    image: options.image ?? runtime.bundlingImage,
    command: ["bash", "-c", `${install}cp -rT /asset-input/ /asset-output/`],
    ...(options.environment ? { environment: options.environment } : {}),
    ...(architecture === Architecture.ARM_64 ? { platform: "linux/arm64" } : {}),
  };
};

/**
 * Python Lambda function with the same defaults as `PlatformFunction`: ARM64,
 * X-Ray, explicit log group, JSON logging controls, platform environment
 * variables and the standard alarms. Dependencies from `requirements.txt` are
 * installed inside the official Lambda build image during synth.
 */
export class PlatformPythonFunction extends LambdaFunction implements DashboardContributor {
  readonly shortName: string;
  readonly logLevel: PlatformLogLevel;
  readonly dlq: IQueue | undefined;
  readonly alarms: FunctionAlarms;

  constructor(scope: Construct, id: string, props: PlatformPythonFunctionProps) {
    const stack = PlatformStack.of(scope);
    const {
      entry,
      index,
      handler,
      runtime: runtimeProp,
      name,
      insights,
      deadLetterQueue,
      logLevel: logLevelProp,
      bundling,
      environment,
      ...fnProps
    } = props;
    const shortName = name ?? kebab(id);
    const functionName = stack.naming.resource("lambdaFunction", shortName);
    const logLevel: PlatformLogLevel = logLevelProp ?? (stack.isPreview ? "debug" : "info");
    const runtime = runtimeProp ?? Runtime.PYTHON_3_13;
    const architecture = fnProps.architecture ?? Architecture.ARM_64;
    const timeout = fnProps.timeout ?? Duration.seconds(10);
    const moduleName = (index ?? "index.py").replace(/\.py$/, "").replace(/[\\/]/g, ".");

    if (!existsSync(entry)) {
      throw new Error(`PlatformPythonFunction ${id}: entry directory ${entry} does not exist`);
    }

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
      memorySize: 1024,
      tracing: Tracing.ACTIVE,
      ...fnProps,
      architecture,
      runtime,
      timeout,
      functionName,
      logGroup,
      handler: `${moduleName}.${handler ?? "handler"}`,
      code: Code.fromAsset(entry, {
        exclude: bundling?.exclude ?? DEFAULT_EXCLUDES,
        bundling: pythonBundling(entry, runtime, architecture, bundling ?? {}),
      }),
      loggingFormat: LoggingFormat.JSON,
      applicationLogLevelV2: LOG_LEVEL_MAP[logLevel],
      systemLogLevelV2: SystemLogLevel.INFO,
      ...(insights ? { insightsVersion: LambdaInsightsVersion.VERSION_1_0_333_0 } : {}),
      ...(dlq ? { deadLetterQueue: dlq } : {}),
      environment: {
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
    this.alarms = createFunctionAlarms(this, shortName, timeout, dlq);
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
    return functionDashboardWidgets(this, this.shortName, this.dlq);
  }
}
