# ADR 0005: GitHub OIDC deploy role model

Status: accepted

## Context

CI needs to deploy CDK apps into AWS accounts. Long-lived access keys and administrator roles are the two most common shortcuts and both are unacceptable for an open-source default.

## Decision

- `AccountBaseline` creates the GitHub OIDC provider once per account and one deploy role per repository and environment.
- Trust policies use the `sub` claim: `repo:<owner>/<repo>:pull_request` for preview roles, `repo:<owner>/<repo>:environment:<env>` for environment roles, and optionally `repo:<owner>/<repo>:ref:refs/heads/<branch>`.
- Deploy roles are least privilege: they may only `sts:AssumeRole` into the CDK bootstrap roles (`cdk-<qualifier>-deploy-role`, `file-publishing-role`, `image-publishing-role`, `lookup-role`) for the account, and read CloudFormation stack descriptions and outputs. The CDK deploy role's own permissions define what CloudFormation may do.
- A separate read-only role (`lookup-role` only, plus describe permissions) is created for `cdk diff` on pull requests.
- Role ARNs are published to SSM and surfaced as GitHub repository variables; workflows never contain account ids.

## Consequences

- Compromise of a CI token cannot exceed what the CDK bootstrap roles allow.
- Users who need broader access can pass an explicit policy or a permissions boundary, but must opt in.
