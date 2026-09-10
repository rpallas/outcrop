import { Duration, Token } from "aws-cdk-lib";
import type { IStage } from "aws-cdk-lib/aws-apigateway";
import {
  ComparisonOperator,
  type IWidget,
  Metric,
  type MetricOptions,
  Stats,
} from "aws-cdk-lib/aws-cloudwatch";
import { CfnWebACL, CfnWebACLAssociation } from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";
import { type PlatformAlarm, type PlatformAlarmOptions, standardAlarm } from "../alerting/alarm";
import { type DashboardContributor, metricWidgets } from "../alerting/service-dashboard";
import { PlatformStack } from "../core/platform-stack";
import { ResourceKind } from "../naming/resource-kind";
import { kebab } from "../util/kebab";

/** WAF scope: `REGIONAL` for API Gateway REST APIs, `CLOUDFRONT` for distributions (us-east-1 only). */
export type PlatformWebAclScope = "REGIONAL" | "CLOUDFRONT";

export interface PlatformWebAclProps {
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /** Default REGIONAL. Use `PlatformWebAcl.forDistribution` for CloudFront. */
  readonly scope?: PlatformWebAclScope;
  /** Requests per 5 minutes per IP before blocking. Default 2000; `false` disables the rule. */
  readonly rateLimit?: number | false;
  /** Include `AWSManagedRulesAmazonIpReputationList`. Default true. */
  readonly ipReputation?: boolean;
  /** Include `AWSManagedRulesKnownBadInputsRuleSet`. Default true. */
  readonly knownBadInputs?: boolean;
  /** Include `AWSManagedRulesCommonRuleSet`. Default true. */
  readonly commonRuleSet?: boolean;
  /** Rules of the common rule set to run in count mode instead of block (e.g. `SizeRestrictions_BODY`). */
  readonly commonRuleSetCountOverrides?: string[];
  /** Extra rules appended after the managed ones (priorities start at 200). */
  readonly additionalRules?: CfnWebACL.RuleProperty[];
}

const visibility = (metricName: string): CfnWebACL.VisibilityConfigProperty => ({
  cloudWatchMetricsEnabled: true,
  sampledRequestsEnabled: true,
  metricName,
});

const managedRuleGroup = (
  name: string,
  priority: number,
  countOverrides: string[] = [],
): CfnWebACL.RuleProperty => ({
  name: `AWS-${name}`,
  priority,
  overrideAction: { none: {} },
  statement: {
    managedRuleGroupStatement: {
      vendorName: "AWS",
      name,
      ...(countOverrides.length > 0
        ? {
            ruleActionOverrides: countOverrides.map((ruleName) => ({
              name: ruleName,
              actionToUse: { count: {} },
            })),
          }
        : {}),
    },
  },
  visibilityConfig: visibility(name),
});

/**
 * WAFv2 web ACL with the AWS managed core rule groups, an IP rate limit and
 * CloudWatch metrics.
 *
 * Associate it with `PlatformRestApi` stages via `associate()` or with a
 * `PlatformDistribution` by passing `webAclId: acl.webAclArn` (the ACL must then
 * be created with `PlatformWebAcl.forDistribution` in a us-east-1 stack).
 *
 * API Gateway **HTTP APIs (`PlatformHttpApi`) cannot be protected by WAF**: WAFv2
 * only supports REST API stages, ALBs, CloudFront, AppSync, Cognito and App
 * Runner. Put a `PlatformDistribution` in front of an HTTP API if it needs WAF.
 */
export class PlatformWebAcl extends Construct implements DashboardContributor {
  /** Create a `CLOUDFRONT` scoped ACL. The stack must be deployed to us-east-1. */
  static forDistribution(
    scope: Construct,
    id: string,
    props: Omit<PlatformWebAclProps, "scope"> = {},
  ): PlatformWebAcl {
    return new PlatformWebAcl(scope, id, { ...props, scope: "CLOUDFRONT" });
  }

  readonly shortName: string;
  readonly aclScope: PlatformWebAclScope;
  readonly resource: CfnWebACL;
  /** Web ACL ARN; pass to `Distribution.webAclId` or use for associations. */
  readonly webAclArn: string;
  readonly webAclId: string;
  readonly webAclName: string;
  readonly alarms: {
    /** Alarm when blocked requests exceed `threshold` per 5 minutes (default 100). */
    blockedRequests: (options?: PlatformAlarmOptions) => PlatformAlarm;
  };
  private associations = 0;

  constructor(scope: Construct, id: string, props: PlatformWebAclProps = {}) {
    super(scope, id);
    const stack = PlatformStack.of(scope);
    const shortName = props.name ?? kebab(id);
    const aclScope = props.scope ?? "REGIONAL";
    if (
      aclScope === "CLOUDFRONT" &&
      !Token.isUnresolved(stack.region) &&
      stack.region !== "us-east-1"
    ) {
      throw new Error(
        `${this.node.path}: CLOUDFRONT scoped web ACLs must be created in us-east-1, but the stack targets ${stack.region}. ` +
          "Create a separate PlatformStack with `env: { region: 'us-east-1' }` for edge resources.",
      );
    }
    this.shortName = shortName;
    this.aclScope = aclScope;
    this.webAclName = stack.naming.resource(ResourceKind.WebAcl, shortName);

    const rules: CfnWebACL.RuleProperty[] = [];
    if (props.commonRuleSet ?? true) {
      rules.push(
        managedRuleGroup("AWSManagedRulesCommonRuleSet", 10, props.commonRuleSetCountOverrides),
      );
    }
    if (props.knownBadInputs ?? true) {
      rules.push(managedRuleGroup("AWSManagedRulesKnownBadInputsRuleSet", 20));
    }
    if (props.ipReputation ?? true) {
      rules.push(managedRuleGroup("AWSManagedRulesAmazonIpReputationList", 30));
    }
    if (props.rateLimit !== false) {
      rules.push({
        name: "RateLimitPerIp",
        priority: 100,
        action: { block: {} },
        statement: {
          rateBasedStatement: { limit: props.rateLimit ?? 2000, aggregateKeyType: "IP" },
        },
        visibilityConfig: visibility("RateLimitPerIp"),
      });
    }
    rules.push(...(props.additionalRules ?? []));

    this.resource = new CfnWebACL(this, "Resource", {
      name: this.webAclName,
      description: `${stack.config.service} ${shortName} ${stack.envName}`,
      scope: aclScope,
      defaultAction: { allow: {} },
      visibilityConfig: visibility(this.webAclName.replace(/[^a-zA-Z0-9_-]/g, "")),
      rules,
    });
    this.webAclArn = this.resource.attrArn;
    this.webAclId = this.resource.attrId;

    this.alarms = {
      blockedRequests: (options = {}) =>
        standardAlarm(this, "BlockedRequestsAlarm", options, {
          name: `${shortName}-blocked-requests`,
          severity: "low",
          metric: this.metric("BlockedRequests", options.metricOptions),
          threshold: 100,
          evaluationPeriods: 1,
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
    };
  }

  /**
   * Associate the ACL with a REST API stage (or any supported resource ARN such
   * as an ALB or Cognito user pool). Not valid for HTTP APIs or CloudFront.
   */
  associate(target: IStage | string): CfnWebACLAssociation {
    if (this.aclScope === "CLOUDFRONT") {
      throw new Error(
        `${this.node.path}: CLOUDFRONT scoped ACLs are attached through Distribution.webAclId, not associations`,
      );
    }
    const stack = PlatformStack.of(this);
    const resourceArn =
      typeof target === "string"
        ? target
        : `arn:${stack.partition}:apigateway:${stack.region}::/restapis/${target.restApi.restApiId}/stages/${target.stageName}`;
    this.associations += 1;
    return new CfnWebACLAssociation(this, `Association${this.associations}`, {
      resourceArn,
      webAclArn: this.webAclArn,
    });
  }

  /** `AWS/WAFV2` metric across all rules of this ACL. */
  metric(metricName: string, options: MetricOptions = {}): Metric {
    return new Metric({
      namespace: "AWS/WAFV2",
      metricName,
      dimensionsMap: {
        WebACL: this.webAclName,
        Region: this.aclScope === "CLOUDFRONT" ? "Global" : PlatformStack.of(this).region,
        Rule: "ALL",
      },
      statistic: Stats.SUM,
      period: Duration.minutes(5),
      ...options,
    });
  }

  /** Widgets for `serviceDashboard`. */
  dashboardWidgets(): IWidget[] {
    return metricWidgets([
      {
        title: `WAF ${this.shortName}: requests`,
        left: [this.metric("AllowedRequests"), this.metric("BlockedRequests")],
        right: [this.metric("CountedRequests")],
      },
    ]);
  }
}
