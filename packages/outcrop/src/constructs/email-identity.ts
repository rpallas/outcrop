import { Duration, Token } from "aws-cdk-lib";
import {
  ComparisonOperator,
  type IWidget,
  Metric,
  type MetricOptions,
  Stats,
} from "aws-cdk-lib/aws-cloudwatch";
import { Effect, type IGrantable, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  type IPublicHostedZone,
  MxRecord,
  PublicHostedZone,
  TxtRecord,
} from "aws-cdk-lib/aws-route53";
import {
  ConfigurationSet,
  ConfigurationSetTlsPolicy,
  EmailIdentity,
  type EmailIdentityProps,
  Identity,
  MailFromBehaviorOnMxFailure,
} from "aws-cdk-lib/aws-ses";
import type { Construct } from "constructs";
import { type PlatformAlarm, type PlatformAlarmOptions, standardAlarm } from "../alerting/alarm";
import { type DashboardContributor, metricWidgets } from "../alerting/service-dashboard";
import { PlatformStack } from "../core/platform-stack";
import { ResourceKind } from "../naming/resource-kind";
import { kebab } from "../util/kebab";

export interface PlatformEmailIdentityProps extends Omit<
  EmailIdentityProps,
  "identity" | "configurationSet" | "mailFromDomain"
> {
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /** Domain to verify. Default: the service hostname (`{service}.{envDomain}`). */
  readonly domain?: string;
  /**
   * Create DKIM (and MAIL FROM) records in the environment hosted zone from the
   * SSM contract. Default true. Set false when the zone is managed elsewhere.
   */
  readonly createDnsRecords?: boolean;
  /**
   * Custom MAIL FROM subdomain: `true` uses `mail.{domain}`, a string sets the
   * full MAIL FROM domain. Default: none (SES default MAIL FROM).
   */
  readonly mailFrom?: boolean | string;
  /** Use an existing configuration set instead of creating one with reputation metrics. */
  readonly configurationSet?: ConfigurationSet;
}

/** Domain identity whose DNS records live in a hosted zone that may be a parent zone. */
class DomainInZoneIdentity extends Identity {
  constructor(
    readonly value: string,
    readonly hostedZone: IPublicHostedZone,
  ) {
    super();
  }
}

/**
 * SES domain identity with Easy DKIM, DNS records in the platform hosted zone,
 * optional custom MAIL FROM, a configuration set with reputation metrics, a
 * scoped `grantSend` and bounce/complaint rate alarms.
 */
export class PlatformEmailIdentity extends EmailIdentity implements DashboardContributor {
  readonly shortName: string;
  /** Verified domain. */
  readonly domain: string;
  readonly configurationSet: ConfigurationSet;
  readonly mailFromDomain: string | undefined;
  readonly alarms: {
    /** Alarm when the bounce rate exceeds `threshold` (fraction; default 0.05). */
    bounceRate: (options?: PlatformAlarmOptions) => PlatformAlarm;
    /** Alarm when the complaint rate exceeds `threshold` (fraction; default 0.001). */
    complaintRate: (options?: PlatformAlarmOptions) => PlatformAlarm;
  };

  constructor(scope: Construct, id: string, props: PlatformEmailIdentityProps = {}) {
    const stack = PlatformStack.of(scope);
    const { name, domain, createDnsRecords, mailFrom, configurationSet, ...identityProps } = props;
    const shortName = name ?? kebab(id);
    const emailDomain = domain ?? stack.domainName;
    if (!emailDomain) {
      throw new Error(
        `${scope.node.path}/${id}: PlatformEmailIdentity needs a domain; the environment has no domain configured.`,
      );
    }
    const mailFromDomain =
      mailFrom === true
        ? `mail.${emailDomain}`
        : typeof mailFrom === "string"
          ? mailFrom
          : undefined;

    let zone: IPublicHostedZone | undefined;
    if (createDnsRecords ?? true) {
      const zoneName = stack.params.env.dnsZoneName();
      if (
        !Token.isUnresolved(zoneName) &&
        emailDomain !== zoneName &&
        !emailDomain.endsWith(`.${zoneName}`)
      ) {
        throw new Error(
          `${scope.node.path}/${id}: domain "${emailDomain}" is not inside the environment hosted zone "${zoneName}". Pass createDnsRecords: false and manage the DKIM records yourself.`,
        );
      }
      zone = PublicHostedZone.fromPublicHostedZoneAttributes(scope, `${id}Zone`, {
        hostedZoneId: stack.params.env.dnsZoneId(),
        zoneName,
      });
    }

    const configSet =
      configurationSet ??
      new ConfigurationSet(scope, `${id}ConfigurationSet`, {
        configurationSetName: stack.naming.resource(ResourceKind.Generic, shortName),
        reputationMetrics: true,
        tlsPolicy: ConfigurationSetTlsPolicy.REQUIRE,
      });

    super(scope, id, {
      dkimSigning: true,
      ...identityProps,
      identity: zone ? new DomainInZoneIdentity(emailDomain, zone) : Identity.domain(emailDomain),
      configurationSet: configSet,
      ...(mailFromDomain
        ? {
            mailFromDomain,
            mailFromBehaviorOnMxFailure:
              identityProps.mailFromBehaviorOnMxFailure ??
              MailFromBehaviorOnMxFailure.REJECT_MESSAGE,
          }
        : {}),
    });
    this.shortName = shortName;
    this.domain = emailDomain;
    this.configurationSet = configSet;
    this.mailFromDomain = mailFromDomain;

    if (zone && mailFromDomain) {
      new MxRecord(this, "MailFromMx", {
        zone,
        recordName: mailFromDomain,
        values: [{ priority: 10, hostName: `feedback-smtp.${stack.region}.amazonses.com` }],
      });
      new TxtRecord(this, "MailFromSpf", {
        zone,
        recordName: mailFromDomain,
        values: ["v=spf1 include:amazonses.com ~all"],
      });
    }

    this.alarms = {
      bounceRate: (options = {}) =>
        standardAlarm(this, "BounceRateAlarm", options, {
          name: `${shortName}-bounce-rate`,
          severity: "high",
          metric: this.reputationMetric("Reputation.BounceRate", options.metricOptions),
          threshold: 0.05,
          evaluationPeriods: 1,
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
      complaintRate: (options = {}) =>
        standardAlarm(this, "ComplaintRateAlarm", options, {
          name: `${shortName}-complaint-rate`,
          severity: "high",
          metric: this.reputationMetric("Reputation.ComplaintRate", options.metricOptions),
          threshold: 0.001,
          evaluationPeriods: 1,
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
    };
  }

  /**
   * Allow the grantee to send email from this identity through the
   * configuration set, optionally restricted to specific `From` addresses
   * (`ses:FromAddress` condition; wildcards allowed, e.g. `*@example.com`).
   */
  grantSend(grantee: IGrantable, fromAddresses?: string[]): PolicyStatement {
    const stack = PlatformStack.of(this);
    const statement = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["ses:SendEmail", "ses:SendRawEmail", "ses:SendTemplatedEmail"],
      resources: [
        this.emailIdentityArn,
        `arn:${stack.partition}:ses:${stack.region}:${stack.account}:configuration-set/${this.configurationSet.configurationSetName}`,
      ],
      ...(fromAddresses && fromAddresses.length > 0
        ? { conditions: { "ForAllValues:StringLike": { "ses:FromAddress": fromAddresses } } }
        : {}),
    });
    grantee.grantPrincipal.addToPrincipalPolicy(statement);
    return statement;
  }

  /** `AWS/SES` metric for the configuration set (`Send`, `Delivery`, `Bounce`, `Complaint`, `Reputation.*`). */
  reputationMetric(metricName: string, options: MetricOptions = {}): Metric {
    return new Metric({
      namespace: "AWS/SES",
      metricName,
      dimensionsMap: { "ses:configuration-set": this.configurationSet.configurationSetName },
      period: Duration.minutes(5),
      statistic: metricName.startsWith("Reputation.") ? Stats.AVERAGE : Stats.SUM,
      ...options,
    });
  }

  /** Widgets for `serviceDashboard`. */
  dashboardWidgets(): IWidget[] {
    return metricWidgets([
      {
        title: `Email ${this.shortName}: sending`,
        left: [this.reputationMetric("Send"), this.reputationMetric("Delivery")],
        right: [this.reputationMetric("Bounce"), this.reputationMetric("Complaint")],
      },
      {
        title: `Email ${this.shortName}: reputation`,
        left: [
          this.reputationMetric("Reputation.BounceRate"),
          this.reputationMetric("Reputation.ComplaintRate"),
        ],
      },
    ]);
  }
}
