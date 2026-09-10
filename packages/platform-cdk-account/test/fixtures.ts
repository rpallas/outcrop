import { App } from "aws-cdk-lib";
import { type AccountConfig, type AccountConfigInput, defineAccountConfig } from "../src/config";

export const baseAccountConfig: AccountConfigInput = {
  project: "example-platform",
  environments: {
    dev: {
      account: "111111111111",
      region: "eu-west-1",
      domain: "dev.example.com",
      alertEmails: ["alerts@example.com"],
      monthlyBudgetUsd: 100,
      github: [
        { owner: "example-org", repo: "orders" },
        { owner: "example-org", repo: "hello-http", branches: ["main"] },
      ],
    },
    prod: {
      account: "222222222222",
      region: "eu-west-1",
      domain: "example.com",
      protected: true,
      github: [{ owner: "example-org", repo: "orders", allowPullRequests: false }],
    },
    global: { account: "111111111111", region: "us-east-1", domain: "us.example.com" },
  },
};

export const testAccountConfig = (overrides: Partial<AccountConfigInput> = {}): AccountConfig =>
  defineAccountConfig({ ...baseAccountConfig, ...overrides });

export const testApp = (env = "dev"): App =>
  new App({ context: { env, "aws:cdk:bundling-stacks": [] } });
