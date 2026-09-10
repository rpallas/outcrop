const { createJestConfig } = require("../../jest.preset");

module.exports = createJestConfig(__dirname, {
  displayName: "hello-http-integration",
  roots: ["<rootDir>/app/tests/integration"],
  testTimeout: 30000,
});
