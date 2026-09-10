import { Stack } from "aws-cdk-lib";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";

export interface AccountNameLookupProps {
  /** Account to describe. Defaults to the current account. */
  readonly accountId?: string;
  /**
   * Role in the management or delegated administrator account that may call
   * `organizations:DescribeAccount` (see `OrganizationsAccessRole`). Without it
   * the call is made with the deploying credentials, which works only from the
   * management account.
   */
  readonly assumeRoleArn?: string;
}

/**
 * Resolves the AWS Organizations account name at deploy time so environment
 * names and domains can be derived from account names in StackSet templates,
 * where no per-account configuration exists.
 */
export class AccountNameLookup extends Construct {
  /** Deploy-time token with the account name. */
  readonly accountName: string;
  /** Deploy-time token with the account email. */
  readonly accountEmail: string;

  constructor(scope: Construct, id: string, props: AccountNameLookupProps = {}) {
    super(scope, id);
    const stack = Stack.of(this);
    const accountId = props.accountId ?? stack.account;
    const resource = new AwsCustomResource(this, "Resource", {
      resourceType: "Custom::AccountNameLookup",
      onUpdate: {
        service: "Organizations",
        action: "describeAccount",
        parameters: { AccountId: accountId },
        physicalResourceId: PhysicalResourceId.of(`account-name-${accountId}`),
        region: "us-east-1",
        ...(props.assumeRoleArn !== undefined ? { assumedRoleArn: props.assumeRoleArn } : {}),
      },
      policy:
        props.assumeRoleArn !== undefined
          ? AwsCustomResourcePolicy.fromStatements([
              new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["sts:AssumeRole"],
                resources: [props.assumeRoleArn],
              }),
            ])
          : AwsCustomResourcePolicy.fromStatements([
              new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["organizations:DescribeAccount"],
                resources: ["*"],
              }),
            ]),
      installLatestAwsSdk: false,
    });
    this.accountName = resource.getResponseField("Account.Name");
    this.accountEmail = resource.getResponseField("Account.Email");
  }
}

export interface AccountNameDomainOptions {
  /** Apex domain, e.g. `example.com`. */
  readonly apexDomain: string;
  /** Prefix shared by all workload accounts that is stripped, e.g. `my-platform-` from `my-platform-dev`. */
  readonly workloadPrefix?: string;
  /** Account names (after prefix removal) that map to the apex itself. Default `["prod", "production"]`. */
  readonly apexNames?: string[];
}

/**
 * Derives an environment name and domain from an account name, the convention
 * used when accounts are created per environment: `my-platform-dev` ->
 * `{ env: "dev", domain: "dev.example.com" }`, `my-platform-prod` ->
 * `{ env: "prod", domain: "example.com" }`.
 */
export const environmentFromAccountName = (
  accountName: string,
  options: AccountNameDomainOptions,
): { env: string; domain: string } => {
  let name = accountName.trim().toLowerCase();
  if (options.workloadPrefix && name.startsWith(options.workloadPrefix.toLowerCase())) {
    name = name.slice(options.workloadPrefix.length);
  }
  const env = name.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!env) throw new Error(`cannot derive an environment name from account name "${accountName}"`);
  const apexNames = options.apexNames ?? ["prod", "production"];
  const domain = apexNames.includes(env) ? options.apexDomain : `${env}.${options.apexDomain}`;
  return { env, domain };
};
