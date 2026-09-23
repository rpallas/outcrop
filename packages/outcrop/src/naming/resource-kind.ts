/**
 * AWS resource types that receive physical names, with their naming constraints.
 * Limits are taken from the AWS service documentation and rounded down where the
 * platform reserves room for prefixes.
 */
export const ResourceKind = {
  Stack: "stack",
  S3Bucket: "s3Bucket",
  LambdaFunction: "lambdaFunction",
  LambdaLayer: "lambdaLayer",
  SqsQueue: "sqsQueue",
  DynamoTable: "dynamoTable",
  LogGroup: "logGroup",
  IamRole: "iamRole",
  IamPolicy: "iamPolicy",
  ApiName: "apiName",
  SnsTopic: "snsTopic",
  StateMachine: "stateMachine",
  EventBus: "eventBus",
  EventRule: "eventRule",
  Schedule: "schedule",
  Secret: "secret",
  KmsAlias: "kmsAlias",
  UserPool: "userPool",
  DistributionComment: "distributionComment",
  SsmParameter: "ssmParameter",
  CloudWatchAlarm: "cloudWatchAlarm",
  Dashboard: "dashboard",
  KinesisStream: "kinesisStream",
  FirehoseStream: "firehoseStream",
  WebAcl: "webAcl",
  Budget: "budget",
  DnsLabel: "dnsLabel",
  Generic: "generic",
} as const;

export type ResourceKind = (typeof ResourceKind)[keyof typeof ResourceKind];

export interface ResourceKindRule {
  /** Maximum length of the physical name. */
  readonly maxLength: number;
  /** Force lowercase output. */
  readonly lowercase: boolean;
  /** Characters that may remain in the name; everything else becomes a separator. */
  readonly allowed: RegExp;
  /** Separator used between segments. */
  readonly separator: string;
}

const KEBAB = /[^a-zA-Z0-9-]/g;
const KEBAB_LOWER = /[^a-z0-9-]/g;
const KEBAB_UNDERSCORE = /[^a-zA-Z0-9_-]/g;
const IAM = /[^a-zA-Z0-9+=,.@_-]/g;
const LOG_GROUP = /[^a-zA-Z0-9_\-/.#]/g;
const SECRET = /[^a-zA-Z0-9/_+=.@-]/g;
const KMS_ALIAS = /[^a-zA-Z0-9/_-]/g;
const SSM = /[^a-zA-Z0-9_.\-/]/g;
const FREE_TEXT = /[^a-zA-Z0-9 _.:\-/#]/g;

const rule = (
  maxLength: number,
  allowed: RegExp,
  lowercase = false,
  separator = "-",
): ResourceKindRule => ({
  maxLength,
  lowercase,
  allowed,
  separator,
});

export const RESOURCE_KIND_RULES: Readonly<Record<ResourceKind, ResourceKindRule>> = {
  stack: rule(128, KEBAB),
  s3Bucket: rule(63, KEBAB_LOWER, true),
  lambdaFunction: rule(64, KEBAB_UNDERSCORE),
  lambdaLayer: rule(64, KEBAB_UNDERSCORE),
  sqsQueue: rule(80, KEBAB_UNDERSCORE),
  dynamoTable: rule(255, /[^a-zA-Z0-9_.-]/g),
  logGroup: rule(512, LOG_GROUP),
  iamRole: rule(64, IAM),
  iamPolicy: rule(128, IAM),
  apiName: rule(128, KEBAB),
  snsTopic: rule(256, KEBAB_UNDERSCORE),
  stateMachine: rule(80, KEBAB_UNDERSCORE),
  eventBus: rule(256, /[^a-zA-Z0-9._-]/g),
  eventRule: rule(64, /[^a-zA-Z0-9._-]/g),
  schedule: rule(64, /[^a-zA-Z0-9._-]/g),
  secret: rule(512, SECRET),
  kmsAlias: rule(256, KMS_ALIAS),
  userPool: rule(128, /[^a-zA-Z0-9_+=,.@ -]/g),
  distributionComment: rule(128, FREE_TEXT),
  ssmParameter: rule(2048, SSM),
  cloudWatchAlarm: rule(255, FREE_TEXT),
  dashboard: rule(255, /[^a-zA-Z0-9_-]/g),
  kinesisStream: rule(128, /[^a-zA-Z0-9_.-]/g),
  firehoseStream: rule(64, /[^a-zA-Z0-9_.-]/g),
  webAcl: rule(128, /[^a-zA-Z0-9_-]/g),
  budget: rule(100, FREE_TEXT),
  dnsLabel: rule(63, KEBAB_LOWER, true),
  generic: rule(255, KEBAB),
};

export const ruleFor = (kind: ResourceKind): ResourceKindRule => RESOURCE_KIND_RULES[kind];
