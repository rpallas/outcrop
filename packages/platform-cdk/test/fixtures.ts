import path from "node:path";
import {
  definePlatformConfig,
  type PlatformConfig,
  type PlatformConfigInput,
} from "../src/config/schema";
import { PlatformApp } from "../src/core/platform-app";
import { PlatformStack, type PlatformStackProps } from "../src/core/platform-stack";

export const baseConfigInput: PlatformConfigInput = {
  project: "Example Platform",
  service: "orders",
  environments: {
    dev: { account: "111111111111", region: "eu-west-1", domain: "dev.example.com" },
    prod: { account: "222222222222", region: "eu-west-1", domain: "example.com", protected: true },
  },
  github: { owner: "example-org", repo: "orders" },
};

export const testConfig = (overrides: Partial<PlatformConfigInput> = {}): PlatformConfig =>
  definePlatformConfig({ ...baseConfigInput, ...overrides });

export interface TestAppOptions {
  readonly config?: PlatformConfig;
  readonly env?: string;
  readonly preview?: boolean;
  readonly previewId?: string;
  readonly prNumber?: string;
  readonly context?: Record<string, unknown>;
}

/** Entry file used by function tests. */
export const HANDLER_ENTRY = path.join(__dirname, "fixtures", "handler.ts");

export const testApp = (options: TestAppOptions = {}): PlatformApp => {
  // Skip esbuild bundling in unit tests; templates still contain the asset references.
  const context: Record<string, unknown> = { "aws:cdk:bundling-stacks": [], ...options.context };
  if (options.env !== undefined) context["env"] = options.env;
  if (options.preview !== undefined) context["preview"] = options.preview;
  if (options.previewId !== undefined) context["previewId"] = options.previewId;
  if (options.prNumber !== undefined) context["prNumber"] = options.prNumber;
  if (context["env"] === undefined && !options.preview) context["env"] = "dev";
  return new PlatformApp({ config: options.config ?? testConfig(), context });
};

export const testStack = (
  options: TestAppOptions & { stackProps?: PlatformStackProps } = {},
): PlatformStack => new PlatformStack(testApp(options), "Service", options.stackProps);

export const previewStack = (previewId = "abc-123"): PlatformStack =>
  testStack({ preview: true, previewId });
