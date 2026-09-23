import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { ComparisonOperator, Metric, Stats } from "aws-cdk-lib/aws-cloudwatch";
import {
  AccountRecovery,
  FeaturePlan,
  type IUserPoolClient,
  Mfa,
  OAuthScope,
  StandardThreatProtectionMode,
  UserPool,
  type UserPoolClient,
  type UserPoolClientOptions,
  type UserPoolDomain,
  type UserPoolProps,
} from "aws-cdk-lib/aws-cognito";
import type { Construct } from "constructs";
import { type PlatformAlarm, type PlatformAlarmOptions, standardAlarm } from "../alerting/alarm";
import { PlatformStack } from "../core/platform-stack";
import { ResourceKind } from "../naming/resource-kind";
import { kebab } from "../util/kebab";

export interface PlatformUserPoolProps extends Omit<
  UserPoolProps,
  | "userPoolName"
  | "selfSignUpEnabled"
  | "deletionProtection"
  | "removalPolicy"
  | "advancedSecurityMode"
  | "featurePlan"
  | "standardThreatProtectionMode"
> {
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /** Allow users to sign themselves up. Default false. */
  readonly selfSignUp?: boolean;
  /**
   * Threat protection (formerly advanced security). Default false: it requires
   * the Plus feature plan and is billed per monthly active user.
   */
  readonly advancedSecurity?: boolean;
}

export interface HostedUiClientOptions extends Omit<UserPoolClientOptions, "oAuth"> {
  /** Allowed redirect URLs after sign-in. */
  readonly callbackUrls: string[];
  /** Allowed redirect URLs after sign-out. */
  readonly logoutUrls?: string[];
  /** OAuth scopes. Default openid, email, profile. */
  readonly scopes?: OAuthScope[];
  /** Prefix for the Cognito hosted domain. Default derived from the platform naming. */
  readonly domainPrefix?: string;
}

/**
 * Cognito user pool with secure defaults: strong password policy, optional
 * MFA, verified email, deletion protection in protected environments, platform
 * naming and helpers for hosted UI clients and alarms.
 */
export class PlatformUserPool extends UserPool {
  readonly shortName: string;
  private lazyDefaultClient: UserPoolClient | undefined;
  private hostedUiDomain: UserPoolDomain | undefined;
  readonly alarms: {
    /** Alarm when sign-in requests are throttled (uses `defaultClient` unless `client` is given). */
    signInThrottles: (
      options?: PlatformAlarmOptions & { client?: IUserPoolClient },
    ) => PlatformAlarm;
  };

  constructor(scope: Construct, id: string, props: PlatformUserPoolProps = {}) {
    const stack = PlatformStack.of(scope);
    const { name, selfSignUp, advancedSecurity, ...poolProps } = props;
    const shortName = name ?? kebab(id);
    const retain = stack.removalPolicy === RemovalPolicy.RETAIN;

    super(scope, id, {
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      mfa: Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      signInCaseSensitive: false,
      ...poolProps,
      userPoolName: stack.naming.resource(ResourceKind.UserPool, shortName),
      selfSignUpEnabled: selfSignUp ?? false,
      deletionProtection: retain,
      removalPolicy: stack.removalPolicy,
      ...(advancedSecurity
        ? {
            featurePlan: FeaturePlan.PLUS,
            standardThreatProtectionMode: StandardThreatProtectionMode.FULL_FUNCTION,
          }
        : { featurePlan: FeaturePlan.ESSENTIALS }),
    });
    this.shortName = shortName;

    this.alarms = {
      signInThrottles: (options = {}) => {
        const { client, ...alarmOptions } = options;
        const userPoolClient = client ?? this.defaultClient;
        return standardAlarm(this, "SignInThrottlesAlarm", alarmOptions, {
          name: `${shortName}-sign-in-throttles`,
          severity: "medium",
          metric: new Metric({
            namespace: "AWS/Cognito",
            metricName: "SignInThrottles",
            dimensionsMap: {
              UserPool: this.userPoolId,
              UserPoolClient: userPoolClient.userPoolClientId,
            },
            period: Duration.minutes(5),
            statistic: Stats.SUM,
            ...options.metricOptions,
          }),
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        });
      },
    };
  }

  /** Hosted UI domain, present after `addHostedUiClient` was called. */
  get hostedDomain(): UserPoolDomain | undefined {
    return this.hostedUiDomain;
  }

  /** App client for direct (SRP) sign-in, created on first access. */
  get defaultClient(): UserPoolClient {
    this.lazyDefaultClient ??= this.addClient("DefaultClient", {
      userPoolClientName: `${this.shortName}-default`,
      authFlows: { userSrp: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
      disableOAuth: true,
    });
    return this.lazyDefaultClient;
  }

  /**
   * Create a hosted UI app client (authorization code grant) and, on first
   * call, a Cognito hosted domain with a prefix derived from the platform naming.
   */
  addHostedUiClient(options: HostedUiClientOptions): UserPoolClient {
    const { callbackUrls, logoutUrls, scopes, domainPrefix, ...clientOptions } = options;
    const stack = PlatformStack.of(this);
    this.hostedUiDomain ??= this.addDomain("HostedUiDomain", {
      cognitoDomain: {
        domainPrefix:
          domainPrefix ?? stack.naming.resource(ResourceKind.DnsLabel, `${this.shortName}-auth`),
      },
    });
    return this.addClient("HostedUiClient", {
      userPoolClientName: `${this.shortName}-hosted-ui`,
      generateSecret: false,
      preventUserExistenceErrors: true,
      ...clientOptions,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: scopes ?? [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
        callbackUrls,
        ...(logoutUrls ? { logoutUrls } : {}),
      },
    });
  }
}
