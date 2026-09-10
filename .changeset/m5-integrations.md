---
"@rpallas/platform-cdk-neon": minor
"@rpallas/platform-cdk-chatops": minor
---

Integrations: `NeonBranch` creates a Neon Postgres branch per preview stack (custom resource, connection details written to a stack-owned Secrets Manager secret, branch deleted with the stack; base environments import the shared `neon-connection` secret). `ChatOpsNotifier` subscribes a Lambda function to the platform alert topics (or any topics) and delivers CloudWatch alarm, AWS Budgets, EventBridge and plain text notifications to Slack (Block Kit) and Microsoft Teams (Adaptive Card) incoming webhooks with severity filtering per destination.
