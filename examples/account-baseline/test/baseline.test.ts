import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { createAccountBaseline } from "@rpallas/outcrop-account";
import config from "../account.config";
import { modules } from "../lib/modules";

const synth = (env: string) => {
  const app = new App({ context: { env } });
  return createAccountBaseline(app, { config, modules });
};

describe("account baseline", () => {
  it.each(Object.keys(config.environments))("synthesises %s", (env) => {
    const { baseline, edge } = synth(env);
    expect(Template.fromStack(baseline).toJSON()).toMatchSnapshot();
    if (edge) expect(Template.fromStack(edge).toJSON()).toMatchSnapshot();
  });

  it("creates a deploy role per repository", () => {
    const { baseline } = synth("dev");
    const template = Template.fromStack(baseline);
    for (const { owner, repo } of config.environments["dev"]?.github ?? []) {
      template.hasResourceProperties("AWS::IAM::Role", {
        RoleName: `platform-dev-deploy-${owner}-${repo}`.toLowerCase(),
      });
    }
  });
});
