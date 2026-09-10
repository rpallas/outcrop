/** @type {import('jest').Config} */
module.exports = {
  projects: [
    "<rootDir>/packages/*/jest.config.js",
    "<rootDir>/examples/*/jest.config.js",
    "<rootDir>/tools/jest.config.js",
  ],
};
