import { Match, Template } from "aws-cdk-lib/assertions";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { type ISecret, Secret } from "aws-cdk-lib/aws-secretsmanager";
import { NeonBranch } from "../src";
import { previewStack, testStack } from "./fixtures";

describe("NeonBranch", () => {
  it("creates a branch custom resource, connection secret and provider in preview stacks", () => {
    const stack = previewStack("pr-42");
    const branch = new NeonBranch(stack, "Db", { projectId: "proud-lake-123456" });
    const template = Template.fromStack(stack);

    expect(branch.isBranch).toBe(true);
    expect(branch.branchName).toBe("pr-42-orders-db");
    expect(branch.branchId).toBeDefined();
    expect(branch.host).toBeDefined();

    template.resourceCountIs("Custom::NeonBranch", 1);
    template.hasResourceProperties("Custom::NeonBranch", {
      projectId: "proud-lake-123456",
      parentBranch: "main",
      branchName: "pr-42-orders-db",
      database: "neondb",
      role: "neondb_owner",
      apiBaseUrl: "https://console.neon.tech/api/v2",
      pooled: "true",
      connectionSecretArn: { Ref: Match.stringLikeRegexp("DbConnection") },
    });
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "pr-42-orders-neon-connection",
    });
    // Handler + provider framework function
    template.resourceCountIs("AWS::Lambda::Function", 2);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "pr-42-orders-handler",
      Timeout: 300,
    });
    // Handler can write the connection secret and read the API key
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["secretsmanager:PutSecretValue"]),
            Resource: { Ref: Match.stringLikeRegexp("DbConnection") },
          }),
          Match.objectLike({
            Action: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
          }),
        ]),
      },
    });
    // API key resolved through the SSM contract
    template.hasParameter("*", {
      Type: "AWS::SSM::Parameter::Value<String>",
      Default: "/platform/secrets/neon-api-key/arn",
    });
    template.hasOutput("DbConnectionSecretArn", {
      Value: { Ref: Match.stringLikeRegexp("DbConnection") },
    });
  });

  it("imports the shared connection secret and creates nothing in base environments", () => {
    const stack = testStack();
    const branch = new NeonBranch(stack, "Db", { projectId: "proud-lake-123456" });
    const template = Template.fromStack(stack);

    expect(branch.isBranch).toBe(false);
    expect(branch.branchId).toBeUndefined();
    expect(branch.host).toBeUndefined();
    expect(branch.handler).toBeUndefined();
    template.resourceCountIs("Custom::NeonBranch", 0);
    template.resourceCountIs("AWS::SecretsManager::Secret", 0);
    template.resourceCountIs("AWS::Lambda::Function", 0);
    template.hasParameter("*", {
      Type: "AWS::SSM::Parameter::Value<String>",
      Default: "/platform/secrets/neon-connection/arn",
    });
    template.hasOutput("DbConnectionSecretArn", {});
  });

  it("creates a branch in base environments when asked", () => {
    const stack = testStack();
    const branch = new NeonBranch(stack, "Db", {
      projectId: "proud-lake-123456",
      createInBaseEnvironment: true,
      baseConnectionSecretName: "ignored",
    });
    expect(branch.isBranch).toBe(true);
    expect(branch.branchName).toBe("orders-db");
    Template.fromStack(stack).resourceCountIs("Custom::NeonBranch", 1);
  });

  it("honours explicit props", () => {
    const stack = previewStack("pr-7");
    // Cast: `Secret` widens optional members with `undefined`, which exactOptionalPropertyTypes rejects.
    const apiKey = new Secret(stack, "ApiKey") as ISecret;
    new NeonBranch(stack, "Db", {
      projectId: "proud-lake-123456",
      apiKeySecret: apiKey,
      parentBranch: "staging",
      branchName: "custom-branch",
      database: "orders",
      role: "orders_app",
      pooled: false,
      suspendTimeoutSeconds: 300,
      apiBaseUrl: "https://neon.example.com/api/v2",
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("Custom::NeonBranch", {
      parentBranch: "staging",
      branchName: "custom-branch",
      database: "orders",
      role: "orders_app",
      pooled: "false",
      suspendTimeoutSeconds: "300",
      apiBaseUrl: "https://neon.example.com/api/v2",
      apiKeySecretArn: { Ref: Match.stringLikeRegexp("ApiKey") },
    });
    const parameters = template.toJSON()["Parameters"] as Record<string, { Default?: string }>;
    const ssmDefaults = Object.values(parameters).map((p) => p.Default);
    expect(ssmDefaults).not.toContain("/platform/secrets/neon-api-key/arn");
  });

  it("grantRead delegates to the connection secret", () => {
    const stack = previewStack();
    const branch = new NeonBranch(stack, "Db", { projectId: "proud-lake-123456" });
    const role = new Role(stack, "Reader", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
    });
    branch.grantRead(role);
    Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
            Resource: { Ref: Match.stringLikeRegexp("DbConnection") },
          }),
        ]),
      },
      Roles: [{ Ref: Match.stringLikeRegexp("Reader") }],
    });
  });

  it("uses the secret name from the base environment when not a branch", () => {
    const stack = testStack();
    new NeonBranch(stack, "Db", {
      projectId: "proud-lake-123456",
      baseConnectionSecretName: "orders-neon",
    });
    Template.fromStack(stack).hasParameter("*", {
      Default: "/platform/secrets/orders-neon/arn",
    });
  });
});
