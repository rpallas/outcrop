/** @type {import('jest').Config} */
module.exports = {
  rootDir: __dirname,
  displayName: "tools",
  testEnvironment: "node",
  roots: ["<rootDir>"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: `${__dirname}/tsconfig.json` }],
  },
};
