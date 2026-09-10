import { Match, Template } from "aws-cdk-lib/assertions";
import { AttributeType, StreamViewType } from "aws-cdk-lib/aws-dynamodb";
import { Key } from "aws-cdk-lib/aws-kms";
import { Topic } from "aws-cdk-lib/aws-sns";
import { PlatformBucket } from "../src/constructs/bucket";
import { PlatformFunction } from "../src/constructs/function";
import { PlatformQueue } from "../src/constructs/queue";
import { PlatformTable } from "../src/constructs/table";
import { HANDLER_ENTRY, previewStack, testStack } from "./fixtures";

describe("PlatformQueue", () => {
  it("applies secure defaults", () => {
    const stack = testStack();
    new PlatformQueue(stack, "Jobs");
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "orders-jobs",
      SqsManagedSseEnabled: true,
      VisibilityTimeout: 60,
      MessageRetentionPeriod: 345600,
    });
    template.hasResourceProperties("AWS::SQS::QueuePolicy", {
      PolicyDocument: {
        Statement: [
          Match.objectLike({
            Effect: "Deny",
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          }),
        ],
      },
    });
  });

  it("creates a dlq with redrive policy", () => {
    const stack = testStack();
    const queue = new PlatformQueue(stack, "Jobs", { deadLetterQueue: 5 });
    queue.alarms.dlqDepth();
    queue.alarms.age();
    queue.alarms.depth();
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::SQS::Queue", { QueueName: "orders-jobs-dlq" });
    template.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "orders-jobs",
      RedrivePolicy: { maxReceiveCount: 5, deadLetterTargetArn: Match.anyValue() },
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-jobs-dlq-depth",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-jobs-age",
      Threshold: 900,
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-jobs-depth",
      Threshold: 1000,
    });
  });

  it("supports fifo and kms", () => {
    const stack = testStack();
    const key = new Key(stack, "K");
    new PlatformQueue(stack, "Events", { fifo: true, encryptionKey: key, deadLetterQueue: true });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "orders-events.fifo",
      FifoQueue: true,
      KmsMasterKeyId: Match.anyValue(),
    });
    template.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "orders-events-dlq.fifo",
      FifoQueue: true,
    });
  });

  it("dlqDepth requires a dlq", () => {
    const stack = testStack();
    expect(() => new PlatformQueue(stack, "Q").alarms.dlqDepth()).toThrow(
      /requires deadLetterQueue/,
    );
  });
});

describe("PlatformTable", () => {
  it("applies defaults", () => {
    const stack = testStack();
    const table = new PlatformTable(stack, "Orders", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
    });
    table.addGsi({
      partitionKey: { name: "gsi1pk", type: AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: AttributeType.STRING },
    });
    table.alarms.throttles();
    table.alarms.systemErrors();
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TableName: "orders-orders",
      BillingMode: "PAY_PER_REQUEST",
      GlobalSecondaryIndexes: [
        Match.objectLike({
          IndexName: "gsi1pk-gsi1sk-index",
          Projection: { ProjectionType: "ALL" },
        }),
      ],
      Replicas: [
        Match.objectLike({
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
          DeletionProtectionEnabled: false,
        }),
      ],
    });
    template.hasResource("AWS::DynamoDB::GlobalTable", { DeletionPolicy: "Delete" });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-orders-throttles",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-orders-system-errors",
    });
  });

  it("previews disable PITR", () => {
    const stack = previewStack();
    new PlatformTable(stack, "Orders", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      stream: true,
    });
    Template.fromStack(stack).hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TableName: "abc-123-orders-orders",
      StreamSpecification: { StreamViewType: "NEW_AND_OLD_IMAGES" },
      Replicas: [
        Match.objectLike({
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false },
        }),
      ],
    });
  });

  it("protected environments retain and protect", () => {
    const stack = testStack({ env: "prod" });
    new PlatformTable(stack, "Orders", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      stream: StreamViewType.KEYS_ONLY,
      timeToLiveAttribute: "ttl",
    });
    const template = Template.fromStack(stack);
    template.hasResource("AWS::DynamoDB::GlobalTable", { DeletionPolicy: "Retain" });
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
      StreamSpecification: { StreamViewType: "KEYS_ONLY" },
      Replicas: [Match.objectLike({ DeletionProtectionEnabled: true })],
    });
  });
});

describe("PlatformBucket", () => {
  it("applies secure defaults and auto-deletes in destroyable stacks", () => {
    const stack = testStack();
    new PlatformBucket(stack, "Uploads", { expireAfterDays: 30, infrequentAccessAfterDays: 7 });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketName: "orders-uploads",
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
        ],
      },
      LifecycleConfiguration: {
        Rules: [
          Match.objectLike({
            Id: "platform-default",
            ExpirationInDays: 30,
            Transitions: [{ StorageClass: "STANDARD_IA", TransitionInDays: 7 }],
          }),
        ],
      },
    });
    template.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Condition: { Bool: { "aws:SecureTransport": "false" } } }),
        ]),
      },
    });
    template.resourceCountIs("Custom::S3AutoDeleteObjects", 1);
  });

  it("protected environments retain without auto delete", () => {
    const stack = testStack({ env: "prod" });
    new PlatformBucket(stack, "Uploads", { versioned: true });
    const template = Template.fromStack(stack);
    template.hasResource("AWS::S3::Bucket", { DeletionPolicy: "Retain" });
    template.hasResourceProperties("AWS::S3::Bucket", {
      VersioningConfiguration: { Status: "Enabled" },
    });
    template.resourceCountIs("Custom::S3AutoDeleteObjects", 0);
  });

  it("supports KMS and access logs from the contract", () => {
    const stack = testStack();
    const key = new Key(stack, "K");
    new PlatformBucket(stack, "Data", { encryptionKey: key, accessLogs: true });
    Template.fromStack(stack).hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          Match.objectLike({
            BucketKeyEnabled: true,
            ServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms" },
          }),
        ],
      },
      LoggingConfiguration: { LogFilePrefix: "data/" },
    });
  });

  it("wires notifications", () => {
    const stack = testStack();
    const bucket = new PlatformBucket(stack, "Uploads");
    const fn = new PlatformFunction(stack, "OnUpload", { entry: HANDLER_ENTRY });
    const queue = new PlatformQueue(stack, "Q");
    const topic = new Topic(stack, "T");
    bucket
      .onObjectCreatedInvoke(fn, { prefix: "in/" })
      .onObjectCreatedEnqueue(queue)
      .onObjectCreatedPublish(topic)
      .onObjectRemovedInvoke(fn);
    Template.fromStack(stack).hasResourceProperties("Custom::S3BucketNotifications", {
      NotificationConfiguration: {
        LambdaFunctionConfigurations: Match.arrayWith([
          Match.objectLike({
            Filter: { Key: { FilterRules: [{ Name: "prefix", Value: "in/" }] } },
          }),
        ]),
        QueueConfigurations: [Match.anyValue()],
        TopicConfigurations: [Match.anyValue()],
      },
    });
  });
});
