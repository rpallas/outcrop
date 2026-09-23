import {
  applyOverflow,
  PlatformNaming,
  sanitise,
  shortHash,
  toPascalCase,
} from "../src/naming/naming";
import { RESOURCE_KIND_RULES, ResourceKind, ruleFor } from "../src/naming/resource-kind";

const account = new PlatformNaming({
  service: "orders",
  env: "dev",
  isolation: "account",
  envDomain: "dev.example.com",
});
const preview = new PlatformNaming({
  service: "orders",
  env: "dev",
  isolation: "account",
  previewId: "abc-123",
  envDomain: "dev.example.com",
});
const shared = new PlatformNaming({
  service: "orders",
  env: "dev",
  isolation: "shared",
  envDomain: "dev.example.com",
});
const sharedPreview = new PlatformNaming({
  service: "orders",
  env: "dev",
  isolation: "shared",
  previewId: "pr-42",
  envDomain: "dev.example.com",
});

describe("PlatformNaming", () => {
  it("builds segments in order", () => {
    expect(account.segments()).toEqual(["orders"]);
    expect(preview.segments()).toEqual(["abc-123", "orders"]);
    expect(shared.segments()).toEqual(["dev", "orders"]);
    expect(sharedPreview.segments()).toEqual(["pr-42", "dev", "orders"]);
  });

  it("names resources", () => {
    expect(account.resource("lambdaFunction", "handler")).toBe("orders-handler");
    expect(preview.resource("lambdaFunction", "handler")).toBe("abc-123-orders-handler");
    expect(shared.resource("lambdaFunction", "handler")).toBe("dev-orders-handler");
    expect(sharedPreview.resource("lambdaFunction", "handler")).toBe("pr-42-dev-orders-handler");
  });

  it("names stacks", () => {
    expect(account.stack()).toBe("Orders");
    expect(account.stack("api")).toBe("OrdersApi");
    expect(preview.stack()).toBe("abc-123-Orders");
    expect(shared.stack()).toBe("Orders-dev");
    expect(sharedPreview.stack("api")).toBe("pr-42-OrdersApi-dev");
  });

  it("lowercases S3 bucket names", () => {
    expect(account.resource("s3Bucket", "Uploads")).toBe("orders-uploads");
  });

  it("sanitises disallowed characters", () => {
    expect(account.resource("lambdaFunction", "my handler!!")).toBe("orders-my-handler");
    expect(sanitise("a//b", ruleFor("logGroup"))).toBe("a//b");
  });

  it("supports bare names", () => {
    expect(preview.resource("iamRole", "custom", { bare: true })).toBe("custom");
  });

  it("renders domains", () => {
    expect(account.domain()).toBe("orders.dev.example.com");
    expect(preview.domain()).toBe("orders-abc-123.dev.example.com");
    expect(preview.domain("{previewId}.{service}.{envDomain}")).toBe(
      "abc-123.orders.dev.example.com",
    );
    expect(
      new PlatformNaming({ service: "orders", env: "dev", isolation: "account" }).domain(),
    ).toBeUndefined();
  });

  it("produces export names and service paths", () => {
    expect(preview.exportName("ApiUrl")).toBe("abc-123-Orders:ApiUrl");
    expect(preview.servicePath("/platform")).toBe("/platform/services/abc-123/orders");
  });

  describe("overflow", () => {
    const long =
      "a-very-long-resource-name-that-will-certainly-exceed-the-limit-of-sixty-four-characters";

    it("hashTail keeps names within limit and deterministic", () => {
      const first = preview.resource("lambdaFunction", long);
      const second = preview.resource("lambdaFunction", long);
      expect(first).toBe(second);
      expect(first.length).toBeLessThanOrEqual(64);
      expect(first).toMatch(/-[0-9a-f]{7}$/);
      expect(first.startsWith("abc-123-orders-a-very-long")).toBe(true);
    });

    it("hashTail differs for different inputs", () => {
      expect(preview.resource("lambdaFunction", long)).not.toBe(
        preview.resource("lambdaFunction", `${long}-x`),
      );
    });

    it("truncateEnd cuts at the limit", () => {
      const name = preview.resource("lambdaFunction", long, { overflow: "truncateEnd" });
      expect(name.length).toBeLessThanOrEqual(64);
      expect(name).not.toMatch(/-$/);
    });

    it("respects S3's 63 char limit", () => {
      const name = preview.resource("s3Bucket", long);
      expect(name.length).toBeLessThanOrEqual(63);
      expect(name).toMatch(/^[a-z0-9-]+$/);
    });

    it("applyOverflow leaves short names alone", () => {
      expect(applyOverflow("short", ruleFor("lambdaFunction"), "hashTail")).toBe("short");
    });
  });

  it("every ResourceKind has a rule", () => {
    for (const kind of Object.values(ResourceKind)) {
      expect(RESOURCE_KIND_RULES[kind].maxLength).toBeGreaterThan(0);
    }
  });

  it("helpers", () => {
    expect(toPascalCase("orders-api_v2")).toBe("OrdersApiV2");
    expect(shortHash("x")).toHaveLength(7);
  });
});
