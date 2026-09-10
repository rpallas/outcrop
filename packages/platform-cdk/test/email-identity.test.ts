import { Match, Template } from "aws-cdk-lib/assertions";
import { PlatformEmailIdentity } from "../src/constructs/email-identity";
import { PlatformFunction } from "../src/constructs/function";
import { HANDLER_ENTRY, testConfig, testStack } from "./fixtures";

describe("PlatformEmailIdentity", () => {
  it("verifies the service domain with DKIM records, MAIL FROM and a configuration set", () => {
    const stack = testStack();
    const identity = new PlatformEmailIdentity(stack, "Mail", { mailFrom: true });
    const fn = new PlatformFunction(stack, "Sender", { entry: HANDLER_ENTRY });
    identity.grantSend(fn, ["no-reply@orders.dev.example.com"]);
    identity.alarms.bounceRate();
    identity.alarms.complaintRate({ threshold: 0.002 });

    expect(identity.domain).toBe("orders.dev.example.com");
    expect(identity.mailFromDomain).toBe("mail.orders.dev.example.com");
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::SES::EmailIdentity", {
      EmailIdentity: "orders.dev.example.com",
      DkimAttributes: { SigningEnabled: true },
      ConfigurationSetAttributes: { ConfigurationSetName: { Ref: Match.anyValue() } },
      MailFromAttributes: {
        MailFromDomain: "mail.orders.dev.example.com",
        BehaviorOnMxFailure: "REJECT_MESSAGE",
      },
    });
    template.hasResourceProperties("AWS::SES::ConfigurationSet", {
      Name: "orders-mail",
      ReputationOptions: { ReputationMetricsEnabled: true },
      DeliveryOptions: { TlsPolicy: "REQUIRE" },
    });
    template.resourcePropertiesCountIs("AWS::Route53::RecordSet", { Type: "CNAME" }, 3);
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "MX",
      Name: "mail.orders.dev.example.com.",
      ResourceRecords: ["10 feedback-smtp.eu-west-1.amazonses.com"],
    });
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "TXT",
      Name: "mail.orders.dev.example.com.",
      ResourceRecords: ['"v=spf1 include:amazonses.com ~all"'],
    });
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ["ses:SendEmail", "ses:SendRawEmail", "ses:SendTemplatedEmail"],
            Condition: {
              "ForAllValues:StringLike": {
                "ses:FromAddress": ["no-reply@orders.dev.example.com"],
              },
            },
          }),
        ]),
      }),
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-mail-bounce-rate",
      Namespace: "AWS/SES",
      MetricName: "Reputation.BounceRate",
      Threshold: 0.05,
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "orders-mail-complaint-rate",
      Threshold: 0.002,
    });
    expect(identity.dashboardWidgets()).toHaveLength(2);
  });

  it("supports explicit domains without DNS records and rejects foreign domains", () => {
    const stack = testStack();
    new PlatformEmailIdentity(stack, "External", {
      domain: "mail.example.org",
      createDnsRecords: false,
    });
    expect(
      () => new PlatformEmailIdentity(stack, "Foreign", { domain: "mail.example.org" }),
    ).toThrow(/not inside the environment hosted zone/);
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::SES::EmailIdentity", {
      EmailIdentity: "mail.example.org",
    });
    template.resourceCountIs("AWS::Route53::RecordSet", 0);
  });

  it("requires a domain", () => {
    const stack = testStack({
      config: testConfig({
        environments: { dev: { account: "111111111111", region: "eu-west-1" } },
      }),
    });
    expect(() => new PlatformEmailIdentity(stack, "Mail")).toThrow(/needs a domain/);
  });
});
