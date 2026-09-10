// Jest setup for handler tests: keep logs quiet and mimic the Lambda environment set by PlatformFunction.
process.env["LOG_LEVEL"] ??= "SILENT";
process.env["PLATFORM_SERVICE"] ??= "hello-http";
process.env["PLATFORM_ENV"] ??= "test";
process.env["PLATFORM_SSM_ROOT"] ??= "/platform";
