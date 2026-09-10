import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import {
  getLogger,
  json,
  noContent,
  notFound,
  parseJsonBody,
  pathParam,
  withHttpHandler,
} from "@rpallas/platform-cdk-runtime";
import { deleteItem, getItem, listItems, putItem } from "../lib/items-repository";

const logger = getLogger();

interface CreateItemInput {
  name: string;
}

const parseCreateItem = (value: unknown): CreateItemInput => {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { name?: unknown }).name !== "string"
  ) {
    throw new Error("body must be an object with a string `name`");
  }
  return { name: (value as { name: string }).name };
};

export const handler = withHttpHandler(
  async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const route = `${event.requestContext.http.method} ${event.routeKey.split(" ")[1] ?? event.rawPath}`;
    logger.debug("routing request", { route });

    switch (event.routeKey) {
      case "GET /health":
        return json(200, {
          ok: true,
          service: process.env["PLATFORM_SERVICE"],
          env: process.env["PLATFORM_ENV"],
        });

      case "GET /items": {
        return json(200, { items: await listItems() });
      }

      case "POST /items": {
        const input = parseJsonBody(event, parseCreateItem);
        const item = { id: crypto.randomUUID(), name: input.name };
        await putItem(item);

        logger.info("item created", { itemId: item.id });
        return json(201, item);
      }

      case "GET /items/{id}": {
        const id = pathParam(event, "id");
        const item = await getItem(id);

        if (!item) throw notFound(`item ${id} not found`);
        return json(200, item);
      }

      case "DELETE /items/{id}": {
        const id = pathParam(event, "id");
        await deleteItem(id);

        return noContent();
      }

      default:
        throw notFound(`no handler for ${event.routeKey}`);
    }
  },
);
