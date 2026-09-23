/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  transform: { "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
  moduleFileExtensions: ["ts", "js", "json"],
  testMatch: ["<rootDir>/test/**/*.test.ts"],
  snapshotSerializers: ["<rootDir>/test/cdk-snapshot-serializer.js"],
  clearMocks: true,
};
