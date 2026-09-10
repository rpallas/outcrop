import type { AccountBaselineModules } from "@rpallas/platform-cdk-account";

/**
 * Modules deployed to every environment. Everything is opt-in; `true` uses the
 * defaults, an object passes options. Remove a module to skip it, for example
 * `security` when GuardDuty and Security Hub are managed by the organisation.
 */
export const modules: AccountBaselineModules = {
  // GitHub Actions OIDC provider and one deploy role per repository (ADR 0005).
  githubOidc: true,
  // IAM alias and password policy, S3 Block Public Access, EBS default encryption, Access Analyzer.
  accountSettings: true,
  // Hosted zone for the environment domain plus regional and us-east-1 wildcard certificates.
  dns: true,
  // SNS topics per alert severity with email subscriptions.
  alerting: true,
  // Platform event bus with a 30 day archive.
  eventBus: true,
  // KMS key used by topics, secrets and audit logs.
  encryption: true,
  // Shared configuration read by services via `params.config(...)` / `getConfig(...)`.
  sharedParameters: {
    values: {
      // "auth0-domain": "example.eu.auth0.com",
      // "auth0-audience": "https://api.example.com",
    },
  },
  // Shared secrets whose values are set out of band (`aws secretsmanager put-secret-value`).
  sharedSecrets: {
    secrets: {
      // "neon-api-key": { description: "Neon API key used to create preview branches" },
      // "slack-webhook": { description: "Incoming webhook for alert notifications" },
    },
  },
  // Monthly cost budget notifying the high-severity topic and alert emails.
  budgets: true,
  // CloudTrail, AWS Config, GuardDuty and Security Hub.
  security: true,
  // Default CloudWatch Logs retention for log groups created without one.
  logRetention: true,
  // Opt-in VPC for functions that need private networking:
  // network: { natGateways: 0 },
};
