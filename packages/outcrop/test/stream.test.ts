import { Match, Template } from "aws-cdk-lib/assertions";
import { Key } from "aws-cdk-lib/aws-kms";
import { Bucket, type IBucket } from "aws-cdk-lib/aws-s3";
import { PlatformDeliveryStream } from "../src/constructs/delivery-stream";
import { PlatformStream } from "../src/constructs/stream";
import { previewStack, testStack } from "./fixtures";

describe("PlatformStream", () => {
  it("creates an on-demand encrypted stream with platform naming and alarms", () => {
    const stack = testStack();
    const stream = new PlatformStream(stack, "Clicks");
    stream.alarms.iteratorAge();
    stream.alarms.writeThrottles();
    stream.alarms.readThrottles({ severity: "medium" });

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Kinesis::Stream", {
      Name: "orders-clicks",
      RetentionPeriodHours: 168,
      StreamModeDetails: { StreamMode: "ON_DEMAND" },
      StreamEncryption: { EncryptionType: "KMS", KeyId: "alias/aws/kinesis" },
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-clicks-iterator-age",
      MetricName: "GetRecords.IteratorAgeMilliseconds",
      Threshold: 300000,
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-clicks-write-throttles",
      MetricName: "WriteProvisionedThroughputExceeded",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-clicks-read-throttles",
      MetricName: "ReadProvisionedThroughputExceeded",
    });
    expect(stream.dashboardWidgets()).toHaveLength(2);
  });

  it("retains in protected environments", () => {
    const stack = testStack({ env: "prod" });
    new PlatformStream(stack, "Clicks");
    Template.fromStack(stack).hasResource("AWS::Kinesis::Stream", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });

  it("shortens retention and destroys in previews, and accepts a customer key", () => {
    const stack = previewStack();
    new PlatformStream(stack, "Clicks", { encryptionKey: new Key(stack, "Key") });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Kinesis::Stream", {
      Name: "abc-123-orders-clicks",
      RetentionPeriodHours: 24,
      StreamEncryption: {
        EncryptionType: "KMS",
        KeyId: { "Fn::GetAtt": [Match.stringLikeRegexp("Key"), "Arn"] },
      },
    });
    template.hasResource("AWS::Kinesis::Stream", { DeletionPolicy: "Delete" });
  });
});

describe("PlatformDeliveryStream", () => {
  it("creates an S3 destination bucket, error log group and alarms by default", () => {
    const stack = testStack();
    const delivery = new PlatformDeliveryStream(stack, "Archive");
    delivery.alarms.deliveryFailures();
    delivery.alarms.deliveryFreshness();

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::KinesisFirehose::DeliveryStream", {
      DeliveryStreamName: "orders-archive",
      DeliveryStreamType: "DirectPut",
      DeliveryStreamEncryptionConfigurationInput: { KeyType: "AWS_OWNED_CMK" },
      ExtendedS3DestinationConfiguration: Match.objectLike({
        CompressionFormat: "GZIP",
        BufferingHints: { IntervalInSeconds: 300, SizeInMBs: 64 },
        Prefix: "data/!{timestamp:yyyy/MM/dd}/",
        ErrorOutputPrefix: "errors/!{firehose:error-output-type}/!{timestamp:yyyy/MM/dd}/",
        CloudWatchLoggingOptions: Match.objectLike({ Enabled: true }),
      }),
    });
    template.hasResourceProperties("AWS::S3::Bucket", { BucketName: "orders-archive-delivery" });
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/aws/kinesisfirehose/orders-archive",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-archive-delivery-failures",
      MetricName: "DeliveryToS3.Success",
      ComparisonOperator: "LessThanThreshold",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-archive-delivery-freshness",
      MetricName: "DeliveryToS3.DataFreshness",
      Threshold: 900,
    });
    expect(delivery.bucket).toBeDefined();
    expect(delivery.dashboardWidgets()).toHaveLength(2);
  });

  it("reads from a Kinesis stream into an existing bucket with a customer key", () => {
    const stack = testStack();
    const source = new PlatformStream(stack, "Clicks");
    // Concrete `Bucket` is not assignable to `IBucket` under exactOptionalPropertyTypes.
    const bucket = new Bucket(stack, "Existing") as IBucket;
    const key = new Key(stack, "Key");
    const delivery = new PlatformDeliveryStream(stack, "Archive", {
      source,
      encryptionKey: key,
      destination: { bucket, dataOutputPrefix: "clicks/" },
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::KinesisFirehose::DeliveryStream", {
      DeliveryStreamType: "KinesisStreamAsSource",
      KinesisStreamSourceConfiguration: Match.objectLike({
        KinesisStreamARN: { "Fn::GetAtt": [Match.stringLikeRegexp("Clicks"), "Arn"] },
      }),
      ExtendedS3DestinationConfiguration: Match.objectLike({
        Prefix: "clicks/",
        BucketARN: { "Fn::GetAtt": [Match.stringLikeRegexp("Existing"), "Arn"] },
        EncryptionConfiguration: Match.objectLike({ KMSEncryptionConfig: Match.anyValue() }),
      }),
    });
    template.resourceCountIs("AWS::S3::Bucket", 1);
    expect(delivery.bucket).toBe(bucket);
  });
});
