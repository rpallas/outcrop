# PlatformTable

DynamoDB `TableV2` with platform defaults.

## Defaults

- On-demand billing, point-in-time recovery outside previews
- Removal policy and name from the stack
- DynamoDB owned encryption unless `encryptionKey` is given

## Props highlights

| Prop                  | Purpose                                             |
| --------------------- | --------------------------------------------------- |
| `stream`              | `true` (`NEW_AND_OLD_IMAGES`) or a `StreamViewType` |
| `pointInTimeRecovery` | Override the preview-aware default                  |

`addGsi({ partitionKey, sortKey })` names the index after its keys and projects all attributes.

## Alarms

`alarms.throttles()`, `alarms.systemErrors()`.

## Example

```ts
const table = new PlatformTable(this, "Orders", {
  partitionKey: { name: "pk", type: AttributeType.STRING },
  sortKey: { name: "sk", type: AttributeType.STRING },
  stream: true,
});
table.addGsi({ partitionKey: { name: "gsi1pk", type: AttributeType.STRING } });
```
