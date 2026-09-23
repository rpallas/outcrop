import { SecretValue } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ArnPrincipal } from "aws-cdk-lib/aws-iam";
import { PlatformFunction } from "../src/constructs/function";
import { PlatformKey } from "../src/constructs/key";
import { PlatformParameter } from "../src/constructs/parameter";
import { PlatformSecret } from "../src/constructs/secret";
import { HANDLER_ENTRY, previewStack, testStack } from "./fixtures";

describe("PlatformKey", () => {
  it("rotates, aliases and applies removal policy plus optional principals", () => {
    const stack = testStack();
    const key = new PlatformKey(stack, "Data", {
      allowedPrincipals: [new ArnPrincipal("arn:aws:iam::111111111111:role/example")],
      grantOrganization: "o-example1234",
    });
    expect(key.aliasName).toBe("alias/orders-data");
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::KMS::Key", {
      EnableKeyRotation: true,
      KeyPolicy: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Sid: "PlatformAllowedPrincipals" }),
          Match.objectLike({
            Sid: "PlatformAllowOrganization",
            Condition: { StringEquals: { "aws:PrincipalOrgID": "o-example1234" } },
          }),
        ]),
      }),
    });
    template.hasResource("AWS::KMS::Key", { DeletionPolicy: "Delete" });
    template.hasResourceProperties("AWS::KMS::Alias", { AliasName: "alias/orders-data" });
  });

  it("retains keys in protected environments", () => {
    const stack = testStack({ env: "prod" });
    new PlatformKey(stack, "Data");
    Template.fromStack(stack).hasResource("AWS::KMS::Key", { DeletionPolicy: "Retain" });
  });
});

describe("PlatformSecret", () => {
  it("generates a value, publishes the ARN and grants read", () => {
    const stack = testStack();
    const secret = new PlatformSecret(stack, "ApiKey", {
      name: "api-key",
      generate: { length: 40 },
    });
    const fn = new PlatformFunction(stack, "Handler", { entry: HANDLER_ENTRY });
    secret.grantRead(fn);
    expect(secret.secretArn).toBeDefined();
    expect(secret.arnParameter).toBeDefined();

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "orders-api-key",
      GenerateSecretString: { PasswordLength: 40, ExcludePunctuation: true },
    });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/services/orders/secrets/api-key/arn",
      Value: { Ref: Match.stringLikeRegexp("ApiKey") },
    });
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
          }),
        ]),
      }),
    });
  });

  it("supports templates, explicit values, preview paths and imports", () => {
    const stack = previewStack();
    new PlatformSecret(stack, "Db", {
      name: "database",
      generate: { template: { username: "app" }, generateKey: "password", length: 24 },
    });
    new PlatformSecret(stack, "Token", {
      name: "token",
      value: SecretValue.unsafePlainText("placeholder"),
      publishArn: false,
    });
    const shared = PlatformSecret.fromPlatform(stack, "auth0-client");
    expect(shared.secretArn).toContain("${Token[");
    expect(
      () =>
        new PlatformSecret(stack, "Bad", {
          name: "bad",
          generate: {},
          value: SecretValue.unsafePlainText("x"),
        }),
    ).toThrow(/either/);

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "abc-123-orders-database",
      GenerateSecretString: {
        PasswordLength: 24,
        SecretStringTemplate: '{"username":"app"}',
        GenerateStringKey: "password",
      },
    });
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "abc-123-orders-token",
      SecretString: "placeholder",
    });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/services/abc-123/orders/secrets/database/arn",
    });
    template.resourceCountIs("AWS::SSM::Parameter", 1);
    template.hasParameter("*", { Default: "/platform/secrets/auth0-client/arn" });
  });
});

describe("PlatformParameter", () => {
  it("writes under the service path and picks the tier automatically", () => {
    const stack = testStack();
    new PlatformParameter(stack, "ApiUrl", { key: "api-url", value: "https://orders.example.com" });
    new PlatformParameter(stack, "Big", { key: "schema", value: "x".repeat(5000) });
    new PlatformParameter(stack, "Custom", { key: "ignored", path: "/custom/path", value: "v" });
    const other = PlatformParameter.serviceValue(stack, "billing", "api-url");
    expect(other).toContain("${Token[");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/services/orders/api-url",
      Value: "https://orders.example.com",
      Tier: "Standard",
    });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/platform/services/orders/schema",
      Tier: "Advanced",
    });
    template.hasResourceProperties("AWS::SSM::Parameter", { Name: "/custom/path" });
    template.hasParameter("*", { Default: "/platform/services/billing/api-url" });
  });
});
