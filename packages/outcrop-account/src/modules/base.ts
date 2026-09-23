import { CfnOutput, RemovalPolicy, Stack } from "aws-cdk-lib";
import { ParameterTier, StringListParameter, StringParameter } from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import type { AccountEnvContext } from "../context";

/** Props shared by every baseline module. */
export interface BaselineModuleProps {
  readonly context: AccountEnvContext;
}

/** Removal policy for account-level resources: protected environments retain everything. */
export const baselineRemovalPolicy = (context: AccountEnvContext): RemovalPolicy =>
  context.environment.protected ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

/** Writes a value to the SSM contract and returns the parameter. */
export const publishParameter = (
  scope: Construct,
  id: string,
  parameterName: string,
  stringValue: string,
  description?: string,
): StringParameter =>
  new StringParameter(scope, id, {
    parameterName,
    stringValue,
    tier: ParameterTier.STANDARD,
    ...(description !== undefined ? { description } : {}),
  });

/** Writes a StringList parameter. */
export const publishListParameter = (
  scope: Construct,
  id: string,
  parameterName: string,
  values: string[],
): StringListParameter =>
  new StringListParameter(scope, id, {
    parameterName,
    stringListValue: values,
    tier: ParameterTier.STANDARD,
  });

/** Adds a stack output with a stable export name derived from the environment. */
export const output = (
  scope: Construct,
  id: string,
  value: string,
  description?: string,
): CfnOutput =>
  new CfnOutput(scope, id, {
    value,
    exportName: `${Stack.of(scope).stackName}-${id}`,
    ...(description !== undefined ? { description } : {}),
  });

/** `my-org/orders` -> `my-org-orders`, safe for IAM role names and SSM path segments. */
export const repoSlug = (owner: string, repo: string): string =>
  `${owner}-${repo}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** `orders-api` -> `OrdersApi` for construct ids and outputs. */
export const pascal = (value: string): string =>
  value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
