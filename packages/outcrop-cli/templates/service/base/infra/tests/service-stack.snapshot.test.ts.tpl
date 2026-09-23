import { Template } from "aws-cdk-lib/assertions";
import { PlatformApp } from "@rpallas/outcrop";
import config from "../../platform.config";
import { {{Service}}Stack } from "../lib/service-stack";

// Synth-time SSM lookups need a concrete account; tests use a placeholder when none is configured.
process.env["CDK_DEFAULT_ACCOUNT"] ??= "111111111111";

// Skip esbuild bundling in snapshot tests; asset references remain in the template.
const synth = (context: Record<string, unknown>) => {
  const app = new PlatformApp({ config, context: { "aws:cdk:bundling-stacks": [], ...context } });
  return Template.fromStack(new {{Service}}Stack(app, "Service")).toJSON();
};

describe("{{Service}}Stack", () => {
  it("matches the dev snapshot", () => {
    expect(synth({ env: "dev" })).toMatchSnapshot();
  });

  it("matches the preview snapshot", () => {
    expect(synth({ env: "dev", preview: true, previewId: "abc-123" })).toMatchSnapshot();
  });
});
