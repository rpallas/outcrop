import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { App, CfnOutput, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { PublicHostedZone } from "aws-cdk-lib/aws-route53";
import { CfnParameter, StringParameter } from "aws-cdk-lib/aws-ssm";
import { AccountNameLookup, environmentFromAccountName } from "../src/org/account-name";
import { OrganizationsAccessRole } from "../src/org/access-role";
import { PlatformStackSet } from "../src/org/stack-set";

const outdir = (): string => mkdtempSync(path.join(os.tmpdir(), "pcdk-stackset-"));

describe("PlatformStackSet", () => {
  it("embeds the synthesised template and targets OUs", () => {
    const app = new App({ outdir: outdir() });
    const stack = new Stack(app, "Admin", {
      env: { account: "111111111111", region: "eu-west-1" },
    });
    const stackSet = new PlatformStackSet(stack, "Baseline", {
      stackSetName: "platform-baseline",
      description: "Baseline in every workload account",
      template: (scope) => {
        const template = new Stack(scope, "Template");
        new StringParameter(template, "Marker", {
          parameterName: "/platform/marker",
          stringValue: "1",
        });
        new CfnOutput(template, "Out", { value: "x" });
        return template;
      },
      targets: {
        organizationalUnitIds: ["ou-example-workloads"],
        regions: ["eu-west-1", "eu-west-2"],
      },
      parameters: { Env: "dev" },
    });
    expect(stackSet.usesAsset).toBe(false);
    expect(stackSet.templateSize).toBeGreaterThan(100);
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::CloudFormation::StackSet", {
      StackSetName: "platform-baseline",
      PermissionModel: "SERVICE_MANAGED",
      CallAs: "DELEGATED_ADMIN",
      AutoDeployment: { Enabled: true, RetainStacksOnAccountRemoval: false },
      Capabilities: ["CAPABILITY_NAMED_IAM", "CAPABILITY_AUTO_EXPAND"],
      Parameters: [{ ParameterKey: "Env", ParameterValue: "dev" }],
      StackInstancesGroup: [
        {
          DeploymentTargets: { OrganizationalUnitIds: ["ou-example-workloads"] },
          Regions: ["eu-west-1", "eu-west-2"],
        },
      ],
      TemplateBody: Match.stringLikeRegexp("AWS::SSM::Parameter"),
    });
    // The template stack is not part of the admin stack.
    template.resourceCountIs("AWS::SSM::Parameter", 0);
  });

  it("supports self-managed targets and dependencies", () => {
    const app = new App({ outdir: outdir() });
    const stack = new Stack(app, "Admin", {
      env: { account: "111111111111", region: "eu-west-1" },
    });
    const first = new PlatformStackSet(stack, "First", {
      stackSetName: "first",
      permissionModel: "SELF_MANAGED",
      administrationRoleArn:
        "arn:aws:iam::111111111111:role/AWSCloudFormationStackSetAdministrationRole",
      executionRoleName: "AWSCloudFormationStackSetExecutionRole",
      template: (scope) => {
        const t = new Stack(scope, "T");
        new CfnParameter(t, "P", { type: "String", value: "1" });
        return t;
      },
      targets: { accounts: ["222222222222", "333333333333"] },
    });
    const second = new PlatformStackSet(stack, "Second", {
      stackSetName: "second",
      permissionModel: "SELF_MANAGED",
      template: (scope) => new Stack(scope, "T"),
      targets: { accounts: ["222222222222"] },
    });
    second.addDependency(first);
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::CloudFormation::StackSet", {
      StackSetName: "first",
      PermissionModel: "SELF_MANAGED",
      AdministrationRoleARN: Match.stringLikeRegexp("AWSCloudFormationStackSetAdministrationRole"),
      StackInstancesGroup: [
        {
          DeploymentTargets: { Accounts: ["222222222222", "333333333333"] },
          Regions: ["eu-west-1"],
        },
      ],
    });
    const resources = template.findResources("AWS::CloudFormation::StackSet");
    const secondResource = Object.entries(resources).find(
      ([, r]) =>
        (r as { Properties: { StackSetName: string } }).Properties.StackSetName === "second",
    );
    expect(secondResource?.[1]).toHaveProperty("DependsOn");
  });

  it("validates targets", () => {
    const app = new App({ outdir: outdir() });
    const stack = new Stack(app, "Admin");
    expect(
      () =>
        new PlatformStackSet(stack, "Bad", {
          stackSetName: "bad",
          template: (scope) => new Stack(scope, "T"),
          targets: { accounts: ["222222222222"] },
        }),
    ).toThrow(/organizationalUnitIds/);
    expect(
      () =>
        new PlatformStackSet(stack, "Bad2", {
          stackSetName: "bad2",
          permissionModel: "SELF_MANAGED",
          template: (scope) => new Stack(scope, "T"),
          targets: {},
        }),
    ).toThrow(/targets.accounts/);
  });
});

describe("OrganizationsAccessRole", () => {
  it("creates a narrowly trusted role", () => {
    const stack = new Stack(new App(), "S", {
      env: { account: "111111111111", region: "eu-west-1" },
    });
    new OrganizationsAccessRole(stack, "Access", {
      trustedAccountId: "222222222222",
      roleName: "platform-org-access",
      externalId: "platform",
      organizationId: "o-example",
      statements: [new PolicyStatement({ actions: ["ssm:GetParameter"], resources: ["*"] })],
    });
    Template.fromStack(stack).hasResourceProperties("AWS::IAM::Role", {
      RoleName: "platform-org-access",
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Principal: { AWS: Match.anyValue() },
            Condition: {
              StringEquals: { "sts:ExternalId": "platform", "aws:PrincipalOrgID": "o-example" },
            },
          }),
        ],
      },
    });
  });

  it("has presets for DNS delegation and parameter reads", () => {
    const stack = new Stack(new App(), "S", {
      env: { account: "111111111111", region: "eu-west-1" },
    });
    const zone = new PublicHostedZone(stack, "Zone", { zoneName: "example.com" });
    OrganizationsAccessRole.dnsDelegation(stack, "Dns", {
      trustedAccountId: "222222222222",
      roleName: "platform-dns-delegation",
      zone,
    });
    OrganizationsAccessRole.parameterReader(stack, "Params", {
      trustedAccountId: "222222222222",
      roleName: "platform-params",
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "platform-dns-delegation",
      Policies: [
        {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({ Action: "route53:ChangeResourceRecordSets" }),
            ]),
          },
        },
      ],
    });
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "platform-params",
      Policies: [
        {
          PolicyDocument: {
            Statement: [
              Match.objectLike({
                Action: ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"],
              }),
            ],
          },
        },
      ],
    });
  });
});

describe("AccountNameLookup", () => {
  it("describes the account through Organizations", () => {
    const stack = new Stack(new App(), "S", {
      env: { account: "111111111111", region: "eu-west-1" },
    });
    const lookup = new AccountNameLookup(stack, "Name", {
      assumeRoleArn: "arn:aws:iam::999999999999:role/platform-org-access",
    });
    new CfnOutput(stack, "AccountName", { value: lookup.accountName });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("Custom::AccountNameLookup", {
      Create: Match.serializedJson(
        Match.objectLike({
          service: "Organizations",
          action: "describeAccount",
          region: "us-east-1",
          assumedRoleArn: "arn:aws:iam::999999999999:role/platform-org-access",
        }),
      ),
    });
    template.hasOutput("AccountName", {
      Value: { "Fn::GetAtt": [Match.anyValue(), "Account.Name"] },
    });
  });

  it("derives environments and domains from account names", () => {
    const options = { apexDomain: "example.com", workloadPrefix: "my-platform-" };
    expect(environmentFromAccountName("my-platform-dev", options)).toEqual({
      env: "dev",
      domain: "dev.example.com",
    });
    expect(environmentFromAccountName("My-Platform-Prod", options)).toEqual({
      env: "prod",
      domain: "example.com",
    });
    expect(environmentFromAccountName("staging", { apexDomain: "example.com" })).toEqual({
      env: "staging",
      domain: "staging.example.com",
    });
    expect(
      environmentFromAccountName("live", { apexDomain: "example.com", apexNames: ["live"] }),
    ).toEqual({ env: "live", domain: "example.com" });
    expect(() => environmentFromAccountName("my-platform-", options)).toThrow(/cannot derive/);
  });
});
