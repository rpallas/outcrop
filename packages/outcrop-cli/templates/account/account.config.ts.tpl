import { defineAccountConfig } from "@rpallas/outcrop-account";

/**
 * Environments of the {{project}} platform. Each environment is an AWS account
 * (or a region within one) with its own domain and the GitHub repositories that
 * may deploy into it. Deploy with `cdk deploy --all -c env=<name>`.
 */
export default defineAccountConfig({
  project: "{{project}}",
  environments: {
    dev: {
      account: "{{devAccount}}",
      region: "{{region}}",
      domain: "dev.{{domain}}",
      logRetentionDays: 30,
      alertEmails: ["platform-alerts@{{domain}}"],
      monthlyBudgetUsd: 200,
      github: [
        // Every service repository that deploys to dev; pull requests get preview stacks.
        { owner: "{{owner}}", repo: "{{name}}", allowPullRequests: false, branches: ["main"] },
      ],
    },
    prod: {
      account: "{{prodAccount}}",
      region: "{{region}}",
      domain: "{{domain}}",
      protected: true,
      logRetentionDays: 365,
      alertEmails: ["platform-alerts@{{domain}}"],
      monthlyBudgetUsd: 1000,
      github: [{ owner: "{{owner}}", repo: "{{name}}", allowPullRequests: false, branches: ["main"] }],
    },
  },
});
