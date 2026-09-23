import { Match, Template } from "aws-cdk-lib/assertions";
import { HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { PlatformFunction } from "../src/constructs/function";
import { PlatformHttpApi, PlatformHttpAuthorizers } from "../src/constructs/http-api";
import { PlatformUserPool } from "../src/constructs/user-pool";
import { HANDLER_ENTRY, previewStack, testStack } from "./fixtures";

describe("PlatformUserPool", () => {
  it("applies secure defaults and platform naming", () => {
    const stack = testStack();
    const pool = new PlatformUserPool(stack, "Users", { selfSignUp: false });
    pool.alarms.signInThrottles();

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolName: "orders-users",
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      MfaConfiguration: "OPTIONAL",
      AutoVerifiedAttributes: ["email"],
      UsernameAttributes: ["email"],
      Policies: {
        PasswordPolicy: Match.objectLike({
          MinimumLength: 12,
          RequireSymbols: true,
          TemporaryPasswordValidityDays: 3,
        }),
      },
      DeletionProtection: "INACTIVE",
      UserPoolTier: "ESSENTIALS",
      Schema: Match.arrayWith([Match.objectLike({ Name: "email", Required: true })]),
    });
    template.hasResource("AWS::Cognito::UserPool", { DeletionPolicy: "Delete" });
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      ClientName: "users-default",
      AllowedOAuthFlows: Match.absent(),
      ExplicitAuthFlows: Match.arrayWith(["ALLOW_USER_SRP_AUTH"]),
      PreventUserExistenceErrors: "ENABLED",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-users-sign-in-throttles",
      Namespace: "AWS/Cognito",
      MetricName: "SignInThrottles",
    });
    expect(pool.defaultClient).toBe(pool.defaultClient);
  });

  it("protects the pool in retain environments and enables self sign-up on request", () => {
    const stack = testStack({ env: "prod" });
    new PlatformUserPool(stack, "Users", { selfSignUp: true });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      DeletionProtection: "ACTIVE",
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: false },
    });
    template.hasResource("AWS::Cognito::UserPool", { DeletionPolicy: "Retain" });
  });

  it("creates a hosted UI client with a domain prefix from naming", () => {
    const stack = previewStack();
    const pool = new PlatformUserPool(stack, "Users", { advancedSecurity: true });
    pool.addHostedUiClient({
      callbackUrls: ["https://app.example.com/callback"],
      logoutUrls: ["https://app.example.com/"],
    });
    expect(pool.hostedDomain).toBeDefined();
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Cognito::UserPoolDomain", {
      Domain: "abc-123-orders-users-auth",
    });
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      ClientName: "users-hosted-ui",
      AllowedOAuthFlows: ["code"],
      AllowedOAuthScopes: ["openid", "email", "profile"],
      CallbackURLs: ["https://app.example.com/callback"],
      LogoutURLs: ["https://app.example.com/"],
    });
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolTier: "PLUS",
      UserPoolAddOns: { AdvancedSecurityMode: "ENFORCED" },
    });
  });

  it("works with PlatformHttpAuthorizers.cognito", () => {
    const stack = testStack();
    const pool = new PlatformUserPool(stack, "Users");
    const fn = new PlatformFunction(stack, "Handler", { entry: HANDLER_ENTRY });
    const api = new PlatformHttpApi(stack, "Api", {
      defaultAuthorizer: PlatformHttpAuthorizers.cognito(pool, {
        userPoolClients: [pool.defaultClient],
      }),
    });
    api.addLambdaRoute("/me", HttpMethod.GET, fn);
    Template.fromStack(stack).hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      AuthorizerType: "JWT",
      JwtConfiguration: Match.objectLike({ Audience: [Match.anyValue()] }),
    });
  });
});
