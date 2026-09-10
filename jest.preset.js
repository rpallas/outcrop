const path = require("node:path");

/**
 * Shared Jest preset for every workspace.
 * @param {string} rootDir absolute path of the workspace
 * @param {import('jest').Config} [overrides]
 * @returns {import('jest').Config}
 */
function createJestConfig(rootDir, overrides = {}) {
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
          tsconfig: path.join(rootDir, "tsconfig.test.json"),
          diagnostics: { ignoreCodes: [151001] },
        },
      ],
    },
    moduleFileExtensions: ["ts", "js", "json"],
    snapshotSerializers: [path.join(__dirname, "tools", "jest", "cdk-snapshot-serializer.js")],
    clearMocks: true,
    ...overrides,
  };
}

module.exports = { createJestConfig };
