import { existsSync } from "node:fs";
import { Annotations, Duration, Fn } from "aws-cdk-lib";
import type { HttpApi, IHttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import {
  AllowedMethods,
  type BehaviorOptions,
  CachePolicy,
  type ErrorResponse,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  OriginProtocolPolicy,
  OriginRequestPolicy,
  OriginSslPolicy,
  ResponseHeadersPolicy,
  type ResponseSecurityHeadersBehavior,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin, S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import type { Bucket, IBucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import { PlatformStack } from "../core/platform-stack";
import { kebab } from "../util/kebab";
import { PlatformBucket } from "./bucket";
import { PlatformDistribution, type PlatformDistributionDomainOptions } from "./distribution";

export interface PlatformStaticSiteApiOrigin {
  /** HTTP API (its execute-api endpoint is used) or an origin URL such as `https://api.example.com`. */
  readonly api: HttpApi | IHttpApi | string;
  /** CloudFront path pattern routed to the API, e.g. `/api/*`. The path is forwarded unchanged. */
  readonly pathPattern: string;
}

export interface PlatformStaticSiteProps extends PlatformDistributionDomainOptions {
  /** Short name; defaults to a kebab-cased construct id. */
  readonly name?: string;
  /** Directory with the built site. When it does not exist the deployment is skipped with a warning. */
  readonly sourcePath: string;
  /** Single page application: serve `/index.html` for 403/404 responses. Default false. */
  readonly spa?: boolean;
  /** Default root object. Default `index.html`. */
  readonly indexDocument?: string;
  /** Page served for 404s when not a SPA, e.g. `/404.html`. */
  readonly errorDocument?: string;
  /** Security headers response policy. Default true (HSTS, nosniff, DENY framing, referrer policy). */
  readonly securityHeaders?: boolean | ResponseSecurityHeadersBehavior;
  /** Content-Security-Policy header value added to the default security headers. */
  readonly contentSecurityPolicy?: string;
  /** Route a path pattern to an HTTP API origin with caching disabled. */
  readonly apiOrigin?: PlatformStaticSiteApiOrigin;
  /** Distribution access logs; see `PlatformDistribution`. */
  readonly accessLogs?: boolean | IBucket | Bucket;
  /** Invalidate the distribution after each deployment. Default true. */
  readonly invalidate?: boolean;
  /** Memory for the deployment handler in MiB. Default 512. */
  readonly deploymentMemoryLimit?: number;
  /** Emit outputs. Default true. */
  readonly outputs?: boolean;
}

const stripProtocol = (url: string): string => url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

/**
 * Static website: private S3 bucket behind CloudFront (origin access control),
 * security headers, optional SPA fallback and API origin, deployed from a local
 * build directory.
 */
export class PlatformStaticSite extends Construct {
  readonly shortName: string;
  readonly bucket: PlatformBucket;
  readonly distribution: PlatformDistribution;
  readonly deployment: BucketDeployment | undefined;
  /** Public base URL without trailing slash. */
  readonly url: string;

  constructor(scope: Construct, id: string, props: PlatformStaticSiteProps) {
    super(scope, id);
    const stack = PlatformStack.of(scope);
    const shortName = props.name ?? kebab(id);
    this.shortName = shortName;
    const indexDocument = props.indexDocument ?? "index.html";

    this.bucket = new PlatformBucket(this, "Bucket", { name: shortName });
    // aws-cdk-lib declares optional class fields as `T | undefined`, which does not
    // satisfy its own interfaces under exactOptionalPropertyTypes; the cast is safe.
    const bucket = this.bucket as IBucket;

    const responseHeadersPolicy =
      props.securityHeaders === false
        ? undefined
        : new ResponseHeadersPolicy(this, "SecurityHeaders", {
            comment: `${stack.config.service} ${shortName} security headers`,
            securityHeadersBehavior:
              typeof props.securityHeaders === "object"
                ? props.securityHeaders
                : {
                    contentTypeOptions: { override: true },
                    frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
                    referrerPolicy: {
                      referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
                      override: true,
                    },
                    strictTransportSecurity: {
                      accessControlMaxAge: Duration.days(365),
                      includeSubdomains: true,
                      preload: true,
                      override: true,
                    },
                    xssProtection: { protection: true, modeBlock: true, override: true },
                    ...(props.contentSecurityPolicy
                      ? {
                          contentSecurityPolicy: {
                            contentSecurityPolicy: props.contentSecurityPolicy,
                            override: true,
                          },
                        }
                      : {}),
                  },
          });

    const errorDocument = props.errorDocument;
    const errorResponses: ErrorResponse[] = props.spa
      ? [403, 404].map((httpStatus) => ({
          httpStatus,
          responseHttpStatus: 200,
          responsePagePath: `/${indexDocument}`,
          ttl: Duration.seconds(0),
        }))
      : errorDocument
        ? [403, 404].map((httpStatus) => ({
            httpStatus,
            responseHttpStatus: 404,
            responsePagePath: errorDocument,
            ttl: Duration.minutes(1),
          }))
        : [];

    const additionalBehaviors: Record<string, BehaviorOptions> = {};
    if (props.apiOrigin) {
      const originHost =
        typeof props.apiOrigin.api === "string"
          ? stripProtocol(props.apiOrigin.api)
          : Fn.select(2, Fn.split("/", props.apiOrigin.api.apiEndpoint));
      additionalBehaviors[props.apiOrigin.pathPattern] = {
        origin: new HttpOrigin(originHost, {
          protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
          originSslProtocols: [OriginSslPolicy.TLS_V1_2],
        }),
        viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        compress: true,
      };
    }

    this.distribution = new PlatformDistribution(this, "Distribution", {
      name: shortName,
      defaultRootObject: indexDocument,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        ...(responseHeadersPolicy ? { responseHeadersPolicy } : {}),
      },
      additionalBehaviors,
      errorResponses,
      ...(props.domain !== undefined ? { domain: props.domain } : {}),
      ...(props.domainPattern !== undefined ? { domainPattern: props.domainPattern } : {}),
      ...(props.disableDomain !== undefined ? { disableDomain: props.disableDomain } : {}),
      ...(props.accessLogs !== undefined ? { accessLogs: props.accessLogs } : {}),
      ...(props.outputs !== undefined ? { outputs: props.outputs } : {}),
    });
    this.url = this.distribution.url;

    if (existsSync(props.sourcePath)) {
      this.deployment = new BucketDeployment(this, "Deployment", {
        sources: [Source.asset(props.sourcePath)],
        destinationBucket: bucket,
        memoryLimit: props.deploymentMemoryLimit ?? 512,
        prune: true,
        ...((props.invalidate ?? true)
          ? { distribution: this.distribution, distributionPaths: ["/*"] }
          : {}),
      });
    } else {
      Annotations.of(this).addWarningV2(
        "@rpallas/outcrop:staticSiteSourceMissing",
        `${this.node.path}: sourcePath "${props.sourcePath}" does not exist; skipping the site deployment. Build the site before synthesising.`,
      );
    }
  }
}
