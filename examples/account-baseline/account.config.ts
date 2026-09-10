import { defineAccountConfig } from "@rpallas/platform-cdk-account";

/**
 * Environments of the example-platform platform. Each environment is an AWS account
 * (or a region within one) with its own domain and the GitHub repositories that
 * may deploy into it. Deploy with `cdk deploy --all -c env=<name>`.
 */
export default defineAccountConfig({
  project: "example-platform",
  environments: {
    dev: {
      account: "111111111111",
      region: "eu-west-1",
      domain: "dev.example.com",
      logRetentionDays: 30,
      alertEmails: ["platform-alerts@example.com"],
      monthlyBudgetUsd: 200,
      github: [
        // Every service repository that deploys to dev; pull requests get preview stacks.
        {
          owner: "example-org",
          repo: "example-platform",
          allowPullRequests: false,
          branches: ["main"],
        },
      ],
    },
    prod: {
      account: "222222222222",
      region: "eu-west-1",
      domain: "example.com",
      protected: true,
      logRetentionDays: 365,
      alertEmails: ["platform-alerts@example.com"],
      monthlyBudgetUsd: 1000,
      github: [
        {
          owner: "example-org",
          repo: "example-platform",
          allowPullRequests: false,
          branches: ["main"],
        },
      ],
    },
  },
});
