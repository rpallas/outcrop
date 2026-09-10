import { CfnOutput, Duration } from "aws-cdk-lib";
import {
  Distribution,
  type DistributionProps,
  HttpVersion,
  SecurityPolicyProtocol,
  SSLMethod,
} from "aws-cdk-lib/aws-cloudfront";
import { ComparisonOperator, type IWidget, Stats } from "aws-cdk-lib/aws-cloudwatch";
import { AaaaRecord, ARecord, RecordTarget } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { type Bucket, type IBucket, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { type PlatformAlarm, type PlatformAlarmOptions, standardAlarm } from "../alerting/alarm";
import { type DashboardContributor, metricWidgets } from "../alerting/service-dashboard";
import { PlatformStack } from "../core/platform-stack";
import { ResourceKind } from "../naming/resource-kind";
import { kebab } from "../util/kebab";
import { pascal } from "../util/pascal";
import { PlatformBucket } from "./bucket";

/** Custom domain options shared by the CloudFront based constructs. */
export interface PlatformDistributionDomainOptions {
  /**
   * Custom hostname. Default: the platform hostname (`{service}.{envDomain}` or
   * the preview pattern) when the environment has a domain. Pass a string to
   * override or `false` to disable.
   */
  readonly domain?: false | string;
  /** Naming pattern used instead of the default (`{service}.{envDomain}` / preview pattern). */
  readonly domainPattern?: string;
  /** Skip the custom domain, certificate and DNS records. Same as `domain: false`. */
  readonly disableDomain?: boolean;
}

export interface PlatformDistributionProps
  extends
    Omit<
      DistributionProps,
      | "domainNames"
      | "certificate"
      | "comment"
      | "minimumProtocolVersion"
      | "sslSupportMethod"
      | "enableLogging"
      | "logBucket"
    >,
    PlatformDistributionDomainOptions {
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /**
   * Standard access logs. `true` creates a log bucket, or pass a bucket that
   * allows ACLs (CloudFront legacy logging needs `ObjectOwnership.OBJECT_WRITER`).
   * Default: on outside previews.
   */
  readonly accessLogs?: boolean | IBucket | Bucket;
  /** Emit `<Name>DomainName` and `<Name>Url` outputs. Default true. */
  readonly outputs?: boolean;
}

/**
 * CloudFront distribution with a custom domain from the platform naming and
 * SSM contract (us-east-1 certificate, Route 53 A/AAAA aliases), TLS 1.2 2021,
 * HTTP/2 + HTTP/3, access logs and error-rate alarms.
 */
export class PlatformDistribution extends Distribution implements DashboardContributor {
  readonly shortName: string;
  /** Custom hostname when a domain is configured. */
  readonly hostname: string | undefined;
  /** Public base URL without trailing slash. */
  readonly url: string;
  readonly logBucket: IBucket | undefined;
  readonly alarms: {
    /** Alarm when the 5xx error rate exceeds `threshold` percent (default 1). */
    serverErrors: (options?: PlatformAlarmOptions) => PlatformAlarm;
    /** Alarm when the 4xx error rate exceeds `threshold` percent (default 10). */
    clientErrors: (options?: PlatformAlarmOptions) => PlatformAlarm;
  };

  constructor(scope: Construct, id: string, props: PlatformDistributionProps) {
    const stack = PlatformStack.of(scope);
    const { name, domain, domainPattern, disableDomain, accessLogs, outputs, ...distProps } = props;
    const shortName = name ?? kebab(id);

    const hostname =
      disableDomain === true || domain === false
        ? undefined
        : typeof domain === "string"
          ? domain
          : stack.naming.domain(domainPattern);

    const logging = accessLogs ?? !stack.isPreview;
    let logBucket: IBucket | undefined;
    if (logging === true) {
      // Cast: aws-cdk-lib optional class fields are `T | undefined`, which does not
      // satisfy IBucket under exactOptionalPropertyTypes.
      logBucket = new PlatformBucket(scope, `${id}Logs`, {
        name: `${shortName}-cf-logs`,
        objectOwnership: ObjectOwnership.OBJECT_WRITER,
        expireAfterDays: 90,
      }) as IBucket;
    } else if (logging) {
      logBucket = logging as IBucket;
    }

    super(scope, id, {
      httpVersion: HttpVersion.HTTP2_AND_3,
      publishAdditionalMetrics: true,
      ...distProps,
      comment: stack.naming.resource(ResourceKind.DistributionComment, shortName),
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      sslSupportMethod: SSLMethod.SNI,
      ...(hostname
        ? { domainNames: [hostname], certificate: stack.params.env.usEast1Certificate() }
        : {}),
      ...(logBucket ? { enableLogging: true, logBucket, logFilePrefix: `${shortName}/` } : {}),
    });
    this.shortName = shortName;
    this.hostname = hostname;
    this.logBucket = logBucket;

    if (hostname) {
      const zone = stack.params.env.hostedZone();
      const target = RecordTarget.fromAlias(new CloudFrontTarget(this));
      new ARecord(scope, `${id}AliasRecord`, { zone, recordName: hostname, target });
      new AaaaRecord(scope, `${id}AliasRecordIpv6`, { zone, recordName: hostname, target });
    }

    this.url = `https://${hostname ?? this.distributionDomainName}`;

    if (outputs ?? true) {
      new CfnOutput(scope, `${id}DomainName`, {
        key: `${pascal(shortName)}DomainName`,
        value: hostname ?? this.distributionDomainName,
      });
      new CfnOutput(scope, `${id}Url`, { key: `${pascal(shortName)}Url`, value: this.url });
    }

    this.alarms = {
      serverErrors: (options = {}) =>
        standardAlarm(this, "ServerErrorsAlarm", options, {
          name: `${shortName}-5xx-rate`,
          severity: "high",
          metric: this.metric5xxErrorRate({
            period: Duration.minutes(5),
            statistic: Stats.AVERAGE,
            ...options.metricOptions,
          }),
          threshold: 1,
          evaluationPeriods: 3,
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
      clientErrors: (options = {}) =>
        standardAlarm(this, "ClientErrorsAlarm", options, {
          name: `${shortName}-4xx-rate`,
          severity: "low",
          metric: this.metric4xxErrorRate({
            period: Duration.minutes(5),
            statistic: Stats.AVERAGE,
            ...options.metricOptions,
          }),
          threshold: 10,
          evaluationPeriods: 3,
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
    };
  }

  /** Widgets for `serviceDashboard`. */
  dashboardWidgets(): IWidget[] {
    return metricWidgets([
      { title: `CDN ${this.shortName}: requests`, left: [this.metricRequests()] },
      {
        title: `CDN ${this.shortName}: error rates (%)`,
        left: [this.metric4xxErrorRate(), this.metric5xxErrorRate()],
      },
      {
        title: `CDN ${this.shortName}: cache hit rate (%)`,
        left: [this.metricCacheHitRate()],
      },
    ]);
  }
}
