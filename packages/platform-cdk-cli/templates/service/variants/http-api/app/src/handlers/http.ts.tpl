import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { getLogger, json, noContent, notFound, parseJsonBody, pathParam, withHttpHandler } from "@rpallas/platform-cdk-runtime";
{{#if hasDynamodb}}
import { deleteItem, getItem, listItems, putItem } from "../lib/items-repository";
{{/if}}

const logger = getLogger();

interface CreateItemInput {
  name: string;
}

const parseCreateItem = (value: unknown): CreateItemInput => {
  if (typeof value !== "object" || value === null || typeof (value as { name?: unknown }).name !== "string") {
    throw new Error("body must be an object with a string `name`");
  }
  return { name: (value as { name: string }).name };
};

{{#unless hasDynamodb}}
// In-memory store for the starter service; replace with a real data store.
const items = new Map<string, { id: string; name: string }>();
{{/unless}}

export const handler = withHttpHandler(
  async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const route = `${event.requestContext.http.method} ${event.routeKey.split(" ")[1] ?? event.rawPath}`;
    logger.debug("routing request", { route });

    switch (event.routeKey) {
      case "GET /health":
        return json(200, { ok: true, service: process.env["PLATFORM_SERVICE"], env: process.env["PLATFORM_ENV"] });

      case "GET /items": {
{{#if hasDynamodb}}
        return json(200, { items: await listItems() });
{{/if}}
{{#unless hasDynamodb}}
        return json(200, { items: [...items.values()] });
{{/unless}}
      }

      case "POST /items": {
        const input = parseJsonBody(event, parseCreateItem);
        const item = { id: crypto.randomUUID(), name: input.name };
{{#if hasDynamodb}}
        await putItem(item);
{{/if}}
{{#unless hasDynamodb}}
        items.set(item.id, item);
{{/unless}}
        logger.info("item created", { itemId: item.id });
        return json(201, item);
      }

      case "GET /items/{id}": {
        const id = pathParam(event, "id");
{{#if hasDynamodb}}
        const item = await getItem(id);
{{/if}}
{{#unless hasDynamodb}}
        const item = items.get(id);
{{/unless}}
        if (!item) throw notFound(`item ${id} not found`);
        return json(200, item);
      }

      case "DELETE /items/{id}": {
        const id = pathParam(event, "id");
{{#if hasDynamodb}}
        await deleteItem(id);
{{/if}}
{{#unless hasDynamodb}}
        items.delete(id);
{{/unless}}
        return noContent();
      }

      default:
        throw notFound(`no handler for ${event.routeKey}`);
    }
  },
);
