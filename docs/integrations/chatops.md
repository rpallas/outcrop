# Slack and Microsoft Teams notifications

`@rpallas/platform-cdk-chatops` turns the platform alert topics into chat messages. The account
baseline creates one SNS topic per severity (`critical`, `high`, `medium`, `low`) and every
`PlatformAlarm` publishes to the topic of its severity. `ChatOpsNotifier` subscribes a Lambda
function to those topics and posts formatted messages to Slack and Teams incoming webhooks.

## Setup

1. Create an incoming webhook in Slack and/or Teams.
2. Add `slack-webhook` / `teams-webhook` to the account baseline's `sharedSecrets` module and
   replace the generated values with the webhook URLs:

   ```sh
   aws secretsmanager put-secret-value \
     --secret-id platform-dev-slack-webhook \
     --secret-string 'https://hooks.example.com/services/T000/B000/XXXX'
   ```

3. Add the notifier once per environment, either in a service stack (defaults to the environment
   topics and shared secrets) or in the account baseline stack with explicit `topics` and
   `webhookSecret`s:

```ts
import { ChatOpsNotifier } from "@rpallas/platform-cdk-chatops";

new ChatOpsNotifier(this, "ChatOps", {
  destinations: [
    { kind: "slack", channelLabel: "#platform-alerts" },
    { kind: "teams", minimumSeverity: "high" },
  ],
});
```

## Routing

Severity is the routing key. Each destination has a `minimumSeverity`, so a Teams channel can
receive only `high` and `critical` while Slack receives everything. Messages carry the environment
(from the topic name), the service and alarm name (from the platform alarm description), the state
reason and a console deep link.

Failed deliveries are retried once and then land in the function's dead letter queue.

See the [package README](../../packages/platform-cdk-chatops/README.md) for props, message
formats, baseline usage and limitations.
