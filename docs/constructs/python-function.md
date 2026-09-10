# PlatformPythonFunction

Python Lambda function with the same conventions as [PlatformFunction](function.md).

## Defaults

- Python 3.13 on ARM64, 1024 MB, 10 second timeout, X-Ray active
- Explicit log group `/aws/lambda/<function>` with the environment retention; JSON log format with `ApplicationLogLevel` from `logLevel` (debug in previews)
- Environment variables: `PLATFORM_PROJECT`, `PLATFORM_SERVICE`, `PLATFORM_ENV`, `PLATFORM_SSM_ROOT`, `PLATFORM_FUNCTION`, `PLATFORM_PREVIEW_ID`, `LOG_LEVEL`, `POWERTOOLS_SERVICE_NAME`, `POWERTOOLS_LOG_LEVEL`, `POWERTOOLS_LOGGER_LOG_EVENT`
- Optional dead letter queue (`deadLetterQueue: true`) and Lambda Insights (`insights: true`)

## Bundling

`entry` is a directory. If it contains `requirements.txt` (or `bundling.requirementsFile`), dependencies are installed with pip inside the official Lambda build image for the runtime and architecture; the directory is then copied on top. `__pycache__`, virtualenvs, caches and `tests` are excluded by default (`bundling.exclude` overrides).

Set the `aws:cdk:bundling-stacks` context to `[]` in tests so no Docker build runs (the test fixtures already do).

## Handler

`index` (default `index.py`) and `handler` (default `handler`) form the Lambda handler string, e.g. `index: "app/main.py", handler: "lambda_handler"` becomes `app.main.lambda_handler`.

## Runtime helpers

There is no Python runtime package yet. Use [AWS Lambda Powertools for Python](https://docs.powertools.aws.dev/lambda/python/latest/); it reads the same `POWERTOOLS_*` variables and emits JSON lines compatible with the platform log format. Read shared configuration with `boto3` from the SSM paths documented in the [SSM contract](../conventions/ssm-contract.md) (`PLATFORM_SSM_ROOT` is the prefix).

## Alarms

`alarms.errors()`, `alarms.throttles()`, `alarms.duration()`, `alarms.deadLetters()` and `addStandardAlarms()` behave exactly like `PlatformFunction`.

## Example

```ts
const report = new PlatformPythonFunction(this, "Report", {
  entry: path.join(__dirname, "..", "..", "app", "report"),
  handler: "lambda_handler",
  timeout: Duration.minutes(2),
  environment: { TABLE_NAME: table.tableName },
});
table.grantReadData(report);
report.addStandardAlarms();
```
