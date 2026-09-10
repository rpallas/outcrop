const base = {
  testEnvironment: "node",
  transform: { "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
  moduleFileExtensions: ["ts", "js", "json"],
  clearMocks: true,
};

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      ...base,
      displayName: "unit",
      testMatch: ["<rootDir>/app/tests/unit/**/*.test.ts"],
      setupFiles: ["<rootDir>/app/tests/setup.ts"],
    },
    {
      ...base,
      displayName: "snapshot",
      testMatch: ["<rootDir>/infra/tests/**/*.test.ts"],
      snapshotSerializers: ["<rootDir>/infra/tests/cdk-snapshot-serializer.js"],
    },
    {
      ...base,
      displayName: "integration",
      testMatch: ["<rootDir>/app/tests/integration/**/*.test.ts"],
      testTimeout: 30000,
    },
  ],
};
