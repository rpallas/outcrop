const { createJestConfig } = require("../../jest.preset");

module.exports = createJestConfig(__dirname, {
  roots: ["<rootDir>/infra", "<rootDir>/app"],
  testPathIgnorePatterns: ["/node_modules/", "/tests/integration/"],
  setupFiles: ["<rootDir>/app/tests/setup.ts"],
});
