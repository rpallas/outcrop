const path = require("node:path");

/**
 * Shared Jest preset for every workspace.
 * @param {string} rootDir absolute path of the workspace
 * @param {import('jest').Config} [overrides]
 * @returns {import('jest').Config}
 */
function createJestConfig(rootDir, overrides = {}) {
  const { setupFiles: extraSetupFiles, ...rest } = overrides;
  return {
    rootDir,
    displayName: path.basename(rootDir),
    testEnvironment: "node",
    roots: ["<rootDir>/src", "<rootDir>/test"],
    testMatch: ["**/*.test.ts"],
    transform: {
      "^.+\\.tsx?$": [
        "ts-jest",
        {
          tsconfig: path.join(rootDir, "tsconfig.json"),
          // Transpile only. Type-checking each test file re-checks aws-cdk-lib
          // and made every suite take about a minute. `tsc` and type-aware
          // ESLint already cover the types. `isolatedModules` comes from tsconfig.
          diagnostics: false,
        },
      ],
    },
    moduleFileExtensions: ["ts", "js", "json"],
    snapshotSerializers: [path.join(__dirname, "tools", "jest", "cdk-snapshot-serializer.js")],
    // aws-cdk-lib prints a stack trace for deprecations inside its own
    // constructors. Quieting them keeps the log readable; we do not call
    // those deprecated properties ourselves.
    setupFiles: [
      path.join(__dirname, "tools", "jest", "quiet-jsii.js"),
      ...(extraSetupFiles ?? []),
    ],
    clearMocks: true,
    ...rest,
  };
}

module.exports = { createJestConfig };
