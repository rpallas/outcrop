import {
  HttpError,
  badRequest,
  conflict,
  forbidden,
  header,
  internalError,
  json,
  noContent,
  notFound,
  parseJsonBody,
  pathParam,
  queryParam,
  redirect,
  tooManyRequests,
  unauthorized,
} from "../src/http";
import { httpEvent } from "./helpers";

/** Runs `fn` and returns the error it throws. */
const thrownBy = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected function to throw");
};

describe("HttpError helpers", () => {
  it("creates errors with the right status codes", () => {
    expect(badRequest("nope", { field: "x" })).toMatchObject({
      statusCode: 400,
      message: "nope",
      details: { field: "x" },
      name: "HttpError",
    });
    expect(unauthorized().statusCode).toBe(401);
    expect(forbidden().statusCode).toBe(403);
    expect(notFound().statusCode).toBe(404);
    expect(conflict().statusCode).toBe(409);
    expect(tooManyRequests().statusCode).toBe(429);
    expect(internalError().statusCode).toBe(500);
    expect(notFound()).toBeInstanceOf(HttpError);
    expect(notFound()).toBeInstanceOf(Error);
    expect(notFound().message).toBe("Not Found");
  });
});

describe("responses", () => {
  it("json sets the content type and serialises the body", () => {
    expect(json(201, { id: 1 }, { "cache-control": "no-store" })).toEqual({
      statusCode: 201,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
      body: '{"id":1}',
    });
  });

  it("noContent and redirect", () => {
    expect(noContent()).toEqual({ statusCode: 204, headers: {} });
    expect(redirect("https://example.com/next")).toEqual({
      statusCode: 302,
      headers: { location: "https://example.com/next" },
    });
    expect(redirect("/x", 301).statusCode).toBe(301);
  });
});

describe("parseJsonBody", () => {
  it("parses plain and base64 bodies", () => {
    expect(parseJsonBody(httpEvent({ body: '{"a":1}' }))).toEqual({ a: 1 });
    const encoded = Buffer.from('{"b":2}').toString("base64");
    expect(parseJsonBody(httpEvent({ body: encoded, isBase64Encoded: true }))).toEqual({ b: 2 });
  });

  it("throws badRequest for missing or invalid bodies", () => {
    expect(thrownBy(() => parseJsonBody(httpEvent()))).toMatchObject({
      statusCode: 400,
      message: "Request body is required",
    });
    expect(thrownBy(() => parseJsonBody(httpEvent({ body: "{oops" })))).toMatchObject({
      statusCode: 400,
      message: "Request body is not valid JSON",
    });
  });

  it("applies the parse function and wraps validation failures", () => {
    const parse = (value: unknown): { a: number } => {
      const record = value as { a?: unknown };
      if (typeof record.a !== "number") {
        const error = new Error("invalid") as Error & { issues: unknown };
        error.issues = [{ path: ["a"], message: "Expected number" }];
        throw error;
      }
      return { a: record.a };
    };
    expect(parseJsonBody(httpEvent({ body: '{"a":1}' }), parse)).toEqual({ a: 1 });
    const error = thrownBy(() => parseJsonBody(httpEvent({ body: '{"a":"x"}' }), parse));
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      statusCode: 400,
      message: "Request body failed validation",
      details: [{ path: ["a"], message: "Expected number" }],
    });
  });
});

describe("request accessors", () => {
  const event = httpEvent({
    pathParameters: { id: "42" },
    queryStringParameters: { page: "2" },
    headers: { "Content-Type": "application/json", "X-Correlation-Id": "abc" },
  });

  it("pathParam returns the value or throws 400", () => {
    expect(pathParam(event, "id")).toBe("42");
    expect(thrownBy(() => pathParam(event, "other"))).toMatchObject({
      statusCode: 400,
      message: 'Missing path parameter "other"',
    });
  });

  it("queryParam returns the value or undefined", () => {
    expect(queryParam(event, "page")).toBe("2");
    expect(queryParam(event, "missing")).toBeUndefined();
    expect(queryParam(httpEvent(), "page")).toBeUndefined();
  });

  it("header is case-insensitive", () => {
    expect(header(event, "content-type")).toBe("application/json");
    expect(header(event, "x-correlation-id")).toBe("abc");
    expect(header(event, "authorization")).toBeUndefined();
  });
});
