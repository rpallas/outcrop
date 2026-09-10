import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { requireEnv } from "@rpallas/platform-cdk-runtime";

export interface Item {
  id: string;
  name: string;
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const tableName = (): string => requireEnv("TABLE_NAME");
const key = (id: string) => ({ pk: `ITEM#${id}`, sk: "ITEM" });

export const putItem = async (item: Item): Promise<void> => {
  await client.send(new PutCommand({ TableName: tableName(), Item: { ...key(item.id), ...item, gsi1pk: "ITEM", gsi1sk: item.name } }));
};

export const getItem = async (id: string): Promise<Item | undefined> => {
  const result = await client.send(new GetCommand({ TableName: tableName(), Key: key(id) }));
  if (!result.Item) return undefined;
  return { id: String(result.Item["id"]), name: String(result.Item["name"]) };
};

export const deleteItem = async (id: string): Promise<void> => {
  await client.send(new DeleteCommand({ TableName: tableName(), Key: key(id) }));
};

export const listItems = async (): Promise<Item[]> => {
  const result = await client.send(new ScanCommand({ TableName: tableName(), Limit: 100 }));
  return (result.Items ?? []).map((record) => ({ id: String(record["id"]), name: String(record["name"]) }));
};
