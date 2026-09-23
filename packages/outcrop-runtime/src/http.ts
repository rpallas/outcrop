import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

/** An error that maps directly to an HTTP response. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const isHttpError = (error: unknown): error is HttpError => error instanceof HttpError;

export const badRequest = (message = "Bad Request", details?: unknown): HttpError =>
  new HttpError(400, message, details);
export const unauthorized = (message = "Unauthorized", details?: unknown): HttpError =>
  new HttpError(401, message, details);
export const forbidden = (message = "Forbidden", details?: unknown): HttpError =>
  new HttpError(403, message, details);
export const notFound = (message = "Not Found", details?: unknown): HttpError =>
  new HttpError(404, message, details);
export const conflict = (message = "Conflict", details?: unknown): HttpError =>
  new HttpError(409, message, details);
export const tooManyRequests = (message = "Too Many Requests", details?: unknown): HttpError =>
  new HttpError(429, message, details);
export const internalError = (message = "Internal Server Error", details?: unknown): HttpError =>
  new HttpError(500, message, details);

export type HttpHeaders = Record<string, string>;

/** JSON response with `content-type: application/json`. */
export function json(
  statusCode: number,
  body: unknown,
  headers: HttpHeaders = {},
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

/** Empty `204 No Content` response. */
export function noContent(headers: HttpHeaders = {}): APIGatewayProxyStructuredResultV2 {
  return { statusCode: 204, headers };
}

/** Redirect response (`302 Found` by default). */
export function redirect(
  location: string,
  statusCode = 302,
  headers: HttpHeaders = {},
): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: { location, ...headers } };
}

/** Raw request body, decoded when API Gateway base64-encoded it. */
export function rawBody(event: APIGatewayProxyEventV2): string | undefined {
  if (event.body === undefined) return undefined;
  return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
}

/**
 * Parses the JSON request body, optionally validating it with `parse`
 * (e.g. `schema.parse` from zod). Throws a 400 {@link HttpError} when the body
 * is missing, is not valid JSON, or `parse` rejects it.
 */
export function parseJsonBody<T = unknown>(
  event: APIGatewayProxyEventV2,
  parse?: (value: unknown) => T,
): T {
  const body = rawBody(event);
  if (body === undefined || body.trim() === "") {
    throw badRequest("Request body is required");
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw badRequest("Request body is not valid JSON");
  }
  if (!parse) return value as T;
  try {
    return parse(value);
  } catch (error) {
    if (isHttpError(error)) throw error;
    throw badRequest("Request body failed validation", describeError(error));
  }
}

const describeError = (error: unknown): unknown => {
  if (error instanceof Error) {
    // zod-style errors expose `issues`; fall back to the message otherwise.
    const issues = (error as Error & { issues?: unknown }).issues;
    return issues ?? error.message;
  }
  return error;
};

/** Path parameter value; throws a 400 {@link HttpError} when missing. */
export function pathParam(event: APIGatewayProxyEventV2, name: string): string {
  const value = event.pathParameters?.[name];
  if (value === undefined || value === "") {
    throw badRequest(`Missing path parameter "${name}"`);
  }
  return value;
}

/** Query string parameter value, or `undefined`. */
export function queryParam(event: APIGatewayProxyEventV2, name: string): string | undefined {
  return event.queryStringParameters?.[name];
}

/** Header value looked up case-insensitively, or `undefined`. */
export function header(event: APIGatewayProxyEventV2, name: string): string | undefined {
  return findHeader(event.headers, name);
}

/** Case-insensitive lookup in a headers map. */
export function findHeader(
  headers: Record<string, string | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}
