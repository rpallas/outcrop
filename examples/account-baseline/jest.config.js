const { createJestConfig } = require("../../jest.preset");

module.exports = createJestConfig(__dirname, {
  roots: ["<rootDir>/lib", "<rootDir>/test"],
});
