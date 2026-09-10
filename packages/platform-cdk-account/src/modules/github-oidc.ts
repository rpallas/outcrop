import { Duration, Stack } from "aws-cdk-lib";
import {
  Effect,
  FederatedPrincipal,
  type IOidcProvider,
  type IRole,
  type ManagedPolicy,
  OidcProviderNative,
  PolicyDocument,
  PolicyStatement,
  Role,
} from "aws-cdk-lib/aws-iam";
import { ResourceKind } from "@rpallas/platform-cdk";
import { Construct } from "constructs";
import type { GitHubRepository } from "../config";
import { type BaselineModuleProps, output, pascal, publishParameter, repoSlug } from "./base";

export const GITHUB_OIDC_URL = "https://token.actions.githubusercontent.com";
export const GITHUB_OIDC_AUDIENCE = "sts.amazonaws.com";

export interface GitHubOidcProps extends BaselineModuleProps {
  /** Import an existing provider instead of creating one (there can be only one per account). */
  readonly existingProviderArn?: string;
  /** Repositories allowed to deploy. Defaults to `environment.github` from the config. */
  readonly repositories?: GitHubRepository[];
  /** Additional statements granted to every deploy role, for the rare case CDK bootstrap roles are not enough. */
  readonly additionalDeployStatements?: PolicyStatement[];
  /** Permissions boundary applied to every role created here. */
  readonly permissionsBoundary?: ManagedPolicy;
  /** Maximum session duration for deploy roles. Default 1 hour. */
  readonly maxSessionDuration?: Duration;
}

export interface RepositoryRoles {
  readonly repository: GitHubRepository;
  readonly deployRole: Role;
  readonly readOnlyRole?: Role;
}

/**
 * GitHub Actions OIDC provider plus one least-privilege deploy role per repository
 * (ADR 0005). Deploy roles may only assume the CDK bootstrap roles of this
 * account/region and read CloudFormation stacks; the bootstrap roles decide what
 * CloudFormation itself may do.
 */
export class GitHubOidc extends Construct {
  readonly provider: IOidcProvider;
  readonly roles: RepositoryRoles[] = [];

  constructor(scope: Construct, id: string, props: GitHubOidcProps) {
    super(scope, id);
    const { context } = props;
    const stack = Stack.of(this);

    this.provider =
      props.existingProviderArn !== undefined
        ? OidcProviderNative.fromOidcProviderArn(this, "Provider", props.existingProviderArn)
        : new OidcProviderNative(this, "Provider", {
            url: GITHUB_OIDC_URL,
            clientIds: [GITHUB_OIDC_AUDIENCE],
          });
    publishParameter(
      this,
      "ProviderArnParam",
      context.paths.account.oidcProviderArn(),
      this.provider.oidcProviderArn,
    );

    const qualifier = context.config.cdkQualifier;
    const bootstrapRole = (name: string): string =>
      stack.formatArn({
        service: "iam",
        region: "",
        resource: "role",
        resourceName: `cdk-${qualifier}-${name}-${stack.account}-${stack.region}`,
      });

    const describeStacks = new PolicyStatement({
      sid: "DescribeStacks",
      effect: Effect.ALLOW,
      actions: [
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents",
        "cloudformation:GetTemplate",
        "cloudformation:ListStacks",
      ],
      resources: ["*"],
    });
    const readBootstrapVersion = new PolicyStatement({
      sid: "ReadBootstrapVersion",
      effect: Effect.ALLOW,
      actions: ["ssm:GetParameter"],
      resources: [
        stack.formatArn({
          service: "ssm",
          resource: "parameter",
          resourceName: `cdk-bootstrap/${qualifier}/version`,
        }),
      ],
    });
    const assumeDeployRoles = new PolicyStatement({
      sid: "AssumeCdkBootstrapRoles",
      effect: Effect.ALLOW,
      actions: ["sts:AssumeRole"],
      resources: [
        "deploy-role",
        "file-publishing-role",
        "image-publishing-role",
        "lookup-role",
      ].map(bootstrapRole),
    });
    const assumeLookupRole = new PolicyStatement({
      sid: "AssumeCdkLookupRole",
      effect: Effect.ALLOW,
      actions: ["sts:AssumeRole"],
      resources: [bootstrapRole("lookup-role")],
    });

    const repositories = props.repositories ?? context.environment.github;
    for (const repository of repositories) {
      const slug = repoSlug(repository.owner, repository.repo);
      const repo = `repo:${repository.owner}/${repository.repo}`;
      const githubEnvironments = repository.githubEnvironments ?? [context.env];
      const deploySubjects = [
        ...githubEnvironments.map((e) => `${repo}:environment:${e}`),
        ...repository.branches.map((b) => `${repo}:ref:refs/heads/${b}`),
        ...(repository.allowPullRequests && !context.environment.protected
          ? [`${repo}:pull_request`]
          : []),
      ];
      const readOnlySubjects = [`${repo}:pull_request`, ...deploySubjects];

      const deployRole = new Role(this, `${pascal(slug)}DeployRole`, {
        roleName: context.naming.resource(ResourceKind.IamRole, `deploy-${slug}`),
        description: `GitHub Actions deploy role for ${repository.owner}/${repository.repo} (${context.env})`,
        assumedBy: this.principal(deploySubjects),
        maxSessionDuration: props.maxSessionDuration ?? Duration.hours(1),
        inlinePolicies: {
          deploy: new PolicyDocument({
            statements: [
              assumeDeployRoles,
              describeStacks,
              readBootstrapVersion,
              ...(props.additionalDeployStatements ?? []),
            ],
          }),
        },
        ...(props.permissionsBoundary ? { permissionsBoundary: props.permissionsBoundary } : {}),
      });
      publishParameter(
        this,
        `${pascal(slug)}DeployRoleArnParam`,
        context.paths.account.deployRoleArn(repository.repo),
        deployRole.roleArn,
      );
      output(
        this,
        `DeployRoleArn${pascal(slug)}`,
        deployRole.roleArn,
        `AWS_DEPLOY_ROLE_ARN for ${repository.owner}/${repository.repo}`,
      );

      let readOnlyRole: Role | undefined;
      if (repository.readOnlyRole) {
        readOnlyRole = new Role(this, `${pascal(slug)}ReadOnlyRole`, {
          roleName: context.naming.resource(ResourceKind.IamRole, `readonly-${slug}`),
          description: `GitHub Actions read-only role (cdk diff) for ${repository.owner}/${repository.repo} (${context.env})`,
          assumedBy: this.principal(readOnlySubjects),
          maxSessionDuration: Duration.hours(1),
          inlinePolicies: {
            readonly: new PolicyDocument({
              statements: [assumeLookupRole, describeStacks, readBootstrapVersion],
            }),
          },
          ...(props.permissionsBoundary ? { permissionsBoundary: props.permissionsBoundary } : {}),
        });
        publishParameter(
          this,
          `${pascal(slug)}ReadOnlyRoleArnParam`,
          context.paths.account.readonlyRoleArn(repository.repo),
          readOnlyRole.roleArn,
        );
        output(
          this,
          `ReadOnlyRoleArn${pascal(slug)}`,
          readOnlyRole.roleArn,
          `AWS_READONLY_ROLE_ARN for ${repository.owner}/${repository.repo}`,
        );
      }

      this.roles.push(
        readOnlyRole ? { repository, deployRole, readOnlyRole } : { repository, deployRole },
      );
    }
  }

  /** Deploy role for a repository, if configured. */
  deployRoleFor(owner: string, repo: string): IRole | undefined {
    return this.roles.find((r) => r.repository.owner === owner && r.repository.repo === repo)
      ?.deployRole;
  }

  private principal(subjects: string[]): FederatedPrincipal {
    return new FederatedPrincipal(
      this.provider.oidcProviderArn,
      {
        StringEquals: { "token.actions.githubusercontent.com:aud": GITHUB_OIDC_AUDIENCE },
        StringLike: { "token.actions.githubusercontent.com:sub": subjects },
      },
      "sts:AssumeRoleWithWebIdentity",
    );
  }
}
