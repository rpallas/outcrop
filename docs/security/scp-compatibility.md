# SCP compatibility and default IAM review

Many organisations attach Service Control Policies (SCPs) that restrict regions, services or IAM actions. This page lists the permissions the platform needs so you can reconcile them with your SCPs before the first deploy, and documents the IAM decisions in the default constructs.

## Regions

- Everything deploys to the environment's `region`, plus **`us-east-1`** for CloudFront certificates (`AccountEdgeStack`, `EdgeCertificate`) and the Organizations API (`AccountNameLookup`).
- If your SCP denies `us-east-1`, allow at least `acm:*`, `ssm:PutParameter`, `ssm:DeleteParameter`, `cloudformation:*`, `lambda:*` and `logs:*` there, or disable `dns.edgeCertificate` and serve static sites without custom domains.

## Services used by the account baseline

| Module            | Services                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GitHubOidc`      | `iam:CreateOpenIDConnectProvider`, `iam:CreateRole`, `iam:PutRolePolicy`, `iam:TagRole`, `ssm:PutParameter`                                                         |
| `AccountSettings` | `iam:CreateAccountAlias`, `iam:UpdateAccountPasswordPolicy`, `s3:PutAccountPublicAccessBlock`, `ec2:EnableEbsEncryptionByDefault`, `access-analyzer:CreateAnalyzer` |
| `Dns`             | `route53:*` on the environment zone, `acm:RequestCertificate`, cross-account `sts:AssumeRole` for delegation                                                        |
| `Alerting`        | `sns:*` on `platform-<env>-alerts-*` topics, `kms:*` on the CMK                                                                                                     |
| `EventBusModule`  | `events:*` on `platform-<env>-events`, `events:CreateArchive`                                                                                                       |
| `Encryption`      | `kms:CreateKey`, `kms:CreateAlias`, `kms:EnableKeyRotation`, `kms:PutKeyPolicy`                                                                                     |
| `Budgets`         | `budgets:*`                                                                                                                                                         |
| `Security`        | `cloudtrail:*`, `config:*`, `guardduty:CreateDetector`, `securityhub:EnableSecurityHub`, `securityhub:BatchEnableStandards`                                         |
| `Network`         | `ec2:*Vpc*`, `ec2:*Subnet*`, `ec2:*VpcEndpoint*`, `ec2:*FlowLogs*`, `ec2:*SecurityGroup*`                                                                           |
| `LogRetention`    | `logs:PutRetentionPolicy`, `logs:DescribeLogGroups`, `events:PutRule`                                                                                               |

All of the above are executed by the CloudFormation execution role from `cdk bootstrap`, not by the GitHub deploy role.

## Common SCP conflicts

| SCP pattern                                              | Effect                                                        | Mitigation                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Deny `iam:CreateOpenIDConnectProvider`                   | `GitHubOidc` fails                                            | Create the provider centrally and set `githubOidc: { existingProviderArn }` in `lib/modules.ts` |
| Deny `guardduty:*` / `securityhub:*` (managed centrally) | `Security` fails                                              | `security: { guardDuty: false, securityHub: false }`                                            |
| Deny `config:PutConfigurationRecorder`                   | `Security` fails                                              | `security: { config: false }`                                                                   |
| Deny `cloudtrail:CreateTrail` (org trail exists)         | `Security` fails                                              | `security: { cloudTrail: false }`                                                               |
| Deny `iam:CreateRole` without permissions boundary       | Every Lambda role fails                                       | See Permissions boundary below                                                                  |
| Deny `ec2:CreateVpc`                                     | `Network` fails                                               | `network: false`; Lambda functions run without a VPC by default                                 |
| Deny `budgets:*`                                         | `Budgets` fails                                               | `budgets: false`                                                                                |
| Region allow-list without `us-east-1`                    | Edge stack and `AccountNameLookup` fail                       | See Regions above                                                                               |
| Deny `kms:ScheduleKeyDeletion`                           | Destroying preview stacks that own a `PlatformKey` fails      | Use the environment CMK (`account.kmsKey`) instead of per-stack keys                            |
| Require `aws:RequestTag` on every resource               | Some L1 resources (e.g. `CfnEventBusPolicy`) cannot be tagged | Exempt untaggable resource types in the SCP condition                                           |

## Default IAM review

The following decisions were reviewed against the AwsSolutions cdk-nag pack and the AWS Foundational Security Best Practices controls. Each suppression in the library is listed with its justification so adopters can decide whether to accept it.

| Location                                        | Finding                                                    | Justification                                                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Lambda execution roles (all constructs)         | `AwsSolutions-IAM4` managed policy                         | `AWSLambdaBasicExecutionRole` / `AWSLambdaVPCAccessExecutionRole`; scoped to the function's own log group in practice       |
| Lambda log permissions, X-Ray, S3 object grants | `AwsSolutions-IAM5` wildcard                               | `logs:*` on `log-group:/aws/lambda/<fn>:*`, `xray:PutTraceSegments` (no resource-level support), `s3:*Object` on `bucket/*` |
| GitHub deploy role                              | `AwsSolutions-IAM5` `cloudformation:DescribeStacks` on `*` | Needed to read outputs of stacks created in the same run; CloudFormation has no tag-based condition for `DescribeStacks`    |
| Custom resource providers                       | `AwsSolutions-L1` runtime                                  | Provider framework runtime is managed by the CDK team; updated on every `aws-cdk-lib` bump                                  |
| CloudTrail / access log buckets                 | `AwsSolutions-S1` access logs                              | Server-access logging on the log bucket itself would loop; CloudTrail data events cover the bucket                          |
| Generated secrets                               | `AwsSolutions-SMG4` rotation                               | Rotation requires a service-specific Lambda; adopters wire `addRotationSchedule` for credentials that support it            |
| Event bus                                       | `AwsSolutions-EB1` (not applicable)                        | Bus policy limits `events:PutEvents` to the organisation or explicit accounts                                               |
| Delivery streams with a Kinesis source          | `AwsSolutions-KDF1` encryption                             | Firehose rejects SSE settings when reading from Kinesis; the source `PlatformStream` is KMS encrypted                       |

Principles applied throughout:

- **One role per function**; never shared execution roles. Grants come from L2 `grant*` methods so actions and resources are enumerated by the CDK.
- **No `iam:PassRole` with `*`.** Where a service must pass a role (Scheduler, Step Functions, Firehose) the resource is the specific role ARN.
- **Cross-account access only through explicit roles** (`OrganizationsAccessRole`) with `aws:PrincipalOrgID` or `sts:ExternalId` conditions.
- **No resource policies that grant to `*`** without a condition; CloudFront origins use OAC, API Gateway uses authorizers, buckets deny non-TLS access.
- **Deploy roles cannot read secrets or data.** They only interact with CloudFormation and the bootstrap roles.

## Permissions boundary

Two places accept a boundary:

- **Deploy roles** created by the baseline: `githubOidc: { permissionsBoundary: ManagedPolicy.fromManagedPolicyName(...) }` in `lib/modules.ts`.
- **Every role a service stack creates**: use the CDK's built-in support. Add to the service's `cdk.json`:

  ```json
  { "context": { "@aws-cdk/core:permissionsBoundary": { "name": "platform-boundary" } } }
  ```

  or set it per stack with `PermissionsBoundary.of(stack).apply(policy)`. Both approaches attach the boundary to Lambda execution roles, custom resource providers and Step Functions roles alike because they run through the CDK's role synthesis, so no platform construct needs to know about it.
