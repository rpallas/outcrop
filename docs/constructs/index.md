# Constructs

Every construct in `@rpallas/outcrop` extends the corresponding `aws-cdk-lib` L2 and adds the platform conventions: names from `PlatformNaming`, removal policies and retention from the environment, encryption with the account key, alarms through `PlatformAlarm` and dashboard widgets. The pages in this section document the options that differ from the underlying L2; everything else is the standard CDK API.

| Area          | Constructs                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| Compute       | `PlatformFunction`, `PlatformPythonFunction`, `PlatformCustomResource`, `PlatformStateMachine`             |
| APIs          | `PlatformHttpApi` + `PlatformHttpAuthorizers`, `PlatformRestApi`, `PlatformWebSocketApi`, `PlatformWebAcl` |
| Storage       | `PlatformTable`, `PlatformBucket`, `PlatformSecret`, `PlatformParameter`, `PlatformKey`                    |
| Messaging     | `PlatformQueue`, `PlatformTopic`, `PlatformEventBus`, `PlatformEventRule`, `PlatformSchedule`              |
| Streaming     | `PlatformStream`, `PlatformDeliveryStream`                                                                 |
| Web           | `PlatformStaticSite`, `PlatformDistribution`                                                               |
| Identity      | `PlatformUserPool`, `PlatformEmailIdentity`                                                                |
| Observability | `PlatformAlarm`, `PlatformDashboard`, `serviceDashboard`                                                   |

Start with [getting started](../guides/getting-started.md) and [new service](../guides/new-service.md); the API reference lists every option.
