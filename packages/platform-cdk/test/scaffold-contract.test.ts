import { Template } from "aws-cdk-lib/assertions";
import type { Construct } from "constructs";
import { PlatformEventRule } from "../src/constructs/event-rule";
import { PlatformFunction } from "../src/constructs/function";
import { PlatformHttpApi, PlatformHttpAuthorizers } from "../src/constructs/http-api";
import { PlatformSchedule } from "../src/constructs/schedule";
import { PlatformSecret } from "../src/constructs/secret";
import { PlatformStaticSite } from "../src/constructs/static-site";
import { PlatformUserPool } from "../src/constructs/user-pool";
import { PlatformStack } from "../src/core/platform-stack";
import { HANDLER_ENTRY, testApp, tmpSiteDir } from "./fixtures";

/**
 * The service scaffolder in `@rpallas/platform-cdk-cli` emits exactly these
 * calls. This stack must keep compiling and synthesising so generated services
 * stay compatible with the construct library.
 */
class ScaffoldedStack extends PlatformStack {
  constructor(scope: Construct, id: string, sourcePath: string) {
    super(scope, id);
    const fn = new PlatformFunction(this, "Handler", { entry: HANDLER_ENTRY });
    const api = new PlatformHttpApi(this, "Api");

    const apiKey = new PlatformSecret(this, "ApiKey", {
      name: "api-key",
      generate: { length: 40 },
    });
    apiKey.grantRead(fn);
    fn.addEnvironment("API_KEY_ARN", apiKey.secretArn);
    new PlatformEventRule(this, "OnExampleEvents", {
      eventNames: ["example.created", "example.updated"],
      targets: [fn],
    });
    new PlatformSchedule(this, "Nightly", { schedule: "cron(0 2 * * ? *)", target: fn });
    const site = new PlatformStaticSite(this, "Site", {
      sourcePath,
      apiOrigin: { api, pathPattern: "/api/*" },
    });
    const userPool = new PlatformUserPool(this, "Users", { selfSignUp: false });
    api.addLambdaProxy(fn, "/api", { authorizer: PlatformHttpAuthorizers.cognito(userPool) });
    fn.addEnvironment("SITE_URL", site.url);
  }
}

describe("scaffold contract", () => {
  it("compiles and synthesises the calls emitted by the service scaffolder", () => {
    const stack = new ScaffoldedStack(testApp(), "Scaffolded", tmpSiteDir());
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::SecretsManager::Secret", 1);
    template.resourceCountIs("AWS::Events::Rule", 1);
    template.resourceCountIs("AWS::Scheduler::Schedule", 1);
    template.resourceCountIs("AWS::CloudFront::Distribution", 1);
    template.resourceCountIs("AWS::Cognito::UserPool", 1);
    template.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", { AuthorizerType: "JWT" });
  });
});
