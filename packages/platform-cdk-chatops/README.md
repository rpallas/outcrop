# @rpallas/platform-cdk-chatops

Delivers platform alerts to Slack and Microsoft Teams incoming webhooks. `ChatOpsNotifier`
subscribes one Lambda function to SNS topics (by default the four per-severity alert topics the
account baseline publishes) and renders CloudWatch alarm state changes, AWS Budgets notifications,
EventBridge events and plain text messages as Slack Block Kit messages or Teams Adaptive Cards.

```sh
npm install @rpallas/platform-cdk-chatops
```

## Creating the webhook secrets

Webhook URLs are secrets. Store them in Secrets Manager, never in code or templates. With the
account baseline (`@rpallas/platform-cdk-account`) declare them as shared secrets:

```ts
sharedSecrets: { secrets: { "slack-webhook": {}, "teams-webhook": {} } },
```

The baseline generates placeholder values and publishes the ARNs under
`/platform/secrets/{name}/arn`. Replace the values once with the real webhook URLs:

```sh
aws secretsmanager put-secret-value \
  --secret-id platform-dev-slack-webhook \
  --secret-string 'https://hooks.example.com/services/T000/B000/XXXX'
```

Plain URL strings and JSON documents `{ "url": "https://..." }` are both accepted.

## Usage from a service stack

Inside a `PlatformStack` everything defaults to the SSM contract: the topics are the environment
alert topics and the secrets are the shared `slack-webhook` / `teams-webhook` secrets.

```ts
import { ChatOpsNotifier } from "@rpallas/platform-cdk-chatops";

new ChatOpsNotifier(this, "ChatOps", {
  destinations: [
    { kind: "slack", channelLabel: "#orders-alerts" },
    { kind: "teams", minimumSeverity: "high", webhookSecretName: "ops-teams-webhook" },
  ],
});
```

Options:

| Prop              | Default                  | Notes                                                       |
| ----------------- | ------------------------ | ----------------------------------------------------------- |
| `destinations`    | required                 | One or more Slack/Teams destinations                        |
| `topics`          | environment alert topics | Any `ITopic[]`; required outside a `PlatformStack`          |
| `severities`      | all four                 | Subset of the default topics to subscribe to                |
| `deadLetterQueue` | `true`                   | `false` to disable, or an existing `IQueue`                 |
| `errorAlarm`      | `true`                   | `errors` alarm on the function (routed to the `high` topic) |
| `timeout`         | 30 seconds               |                                                             |

Per destination: `kind` (`slack` or `teams`), `webhookSecretName` or `webhookSecret`,
`minimumSeverity` (default `low`, meaning everything) and an optional `channelLabel` rendered in
the message.

The construct exposes `handler` (a `PlatformFunction` inside a `PlatformStack`), `topics`,
`destinations`, `deadLetterQueue` and `errorAlarm`.

## Usage from the account baseline

The account baseline stack is a plain `Stack`, and the natural place to route the environment's
alert topics because it owns them. Outside a `PlatformStack` the construct falls back to a plain
`NodejsFunction` (ARM64, Node.js 24, X-Ray, one-month log retention) and requires explicit `topics`
and a `webhookSecret` per destination; the errors alarm is not created there.

```ts
import { ALERT_SEVERITIES } from "@rpallas/platform-cdk";
import { createAccountBaseline } from "@rpallas/platform-cdk-account";
import { ChatOpsNotifier } from "@rpallas/platform-cdk-chatops";

const { baseline } = createAccountBaseline(app, { config, modules });
const { alerting, sharedSecrets } = baseline.baseline;
const slackWebhook = sharedSecrets?.secrets["slack-webhook"];
if (alerting && slackWebhook) {
  new ChatOpsNotifier(baseline, "ChatOps", {
    topics: ALERT_SEVERITIES.map((severity) => alerting.topics[severity]),
    destinations: [{ kind: "slack", webhookSecret: slackWebhook }],
  });
}
```

## What gets delivered

Each SNS record is normalised into one message:

- **CloudWatch alarms** – header `:rotating_light: <alarm> is ALARM` (`:white_check_mark:` for
  `OK`, `:grey_question:` for `INSUFFICIENT_DATA`), fields for severity, environment, service,
  account, region, time, metric and threshold, the state reason, and a deep link to the alarm in
  the console. Service and severity come from the platform alarm description
  (`[high] orders: api-errors`); the environment from the topic name (`platform-dev-alerts-high`).
- **AWS Budgets** – budget name, threshold and current amount extracted from the notification text.
- **EventBridge events** – `detail-type`, `source` and the pretty-printed `detail`.
- **Anything else** – subject and message text.

Severity is taken from the `platform:severity` SNS message attribute when present, otherwise from
the topic name suffix (`...-alerts-critical`), otherwise `medium`. Destinations with a
`minimumSeverity` above the message severity are skipped.

Slack messages use Block Kit (`header`, `section` fields, `context` with the console link). Teams
messages are `application/vnd.microsoft.card.adaptive` attachments with an Adaptive Card 1.4
(`TextBlock`, `FactSet`, `Action.OpenUrl`).

Delivery failures with `429` or `5xx` responses are retried once; a persistent failure makes the
invocation fail so the SNS retry policy and the dead letter queue apply.

## Limitations

- Incoming webhooks only; no interactive messages, threading or acknowledgements.
- Both Slack and Teams truncate long payloads; reasons and bodies are cut to fit.
- Webhook URLs are cached for the lifetime of the Lambda execution environment; rotate a secret and
  the function picks it up after the next cold start or a failed delivery.
- The `errors` alarm of the notifier itself routes to the `high` topic, so a notifier that is
  permanently broken produces a notification it cannot deliver; the dead letter queue keeps those.
