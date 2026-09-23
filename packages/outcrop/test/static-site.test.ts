import { tmpdir } from "node:os";
import path from "node:path";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { PlatformHttpApi } from "../src/constructs/http-api";
import { PlatformStaticSite } from "../src/constructs/static-site";
import { testStack, tmpSiteDir } from "./fixtures";

describe("PlatformStaticSite", () => {
  it("creates a private bucket, OAC distribution, SPA fallback, headers and API origin", () => {
    const stack = testStack();
    const api = new PlatformHttpApi(stack, "Api", { outputs: false });
    const site = new PlatformStaticSite(stack, "Site", {
      sourcePath: tmpSiteDir(),
      spa: true,
      apiOrigin: { api, pathPattern: "/api/*" },
      contentSecurityPolicy: "default-src 'self'",
    });

    expect(site.url).toBe("https://orders.dev.example.com");
    expect(site.deployment).toBeDefined();
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketName: "orders-site",
      PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicAcls: true }),
    });
    template.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: "index.html",
        CustomErrorResponses: [
          Match.objectLike({ ErrorCode: 403, ResponseCode: 200, ResponsePagePath: "/index.html" }),
          Match.objectLike({ ErrorCode: 404, ResponseCode: 200, ResponsePagePath: "/index.html" }),
        ],
        CacheBehaviors: [
          Match.objectLike({
            PathPattern: "/api/*",
            AllowedMethods: Match.arrayWith(["POST", "DELETE"]),
            CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
            OriginRequestPolicyId: "b689b0a8-53d0-40ab-baf2-68738e2966ac",
          }),
        ],
        Origins: Match.arrayWith([
          Match.objectLike({
            CustomOriginConfig: Match.objectLike({
              OriginProtocolPolicy: "https-only",
              OriginSSLProtocols: ["TLSv1.2"],
            }),
          }),
        ]),
      }),
    });
    template.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          StrictTransportSecurity: Match.objectLike({ Preload: true }),
          FrameOptions: { FrameOption: "DENY", Override: true },
          ContentSecurityPolicy: { ContentSecurityPolicy: "default-src 'self'", Override: true },
        }),
      }),
    });
    template.hasResourceProperties("Custom::CDKBucketDeployment", {
      DistributionPaths: ["/*"],
      Prune: true,
    });
  });

  it("skips the deployment with a warning when the source is missing", () => {
    const stack = testStack();
    const site = new PlatformStaticSite(stack, "Docs", {
      sourcePath: path.join(tmpdir(), "definitely-missing-outcrop-site"),
      errorDocument: "/404.html",
      apiOrigin: { api: "https://api.example.com/v1", pathPattern: "/api/*" },
      securityHeaders: false,
      accessLogs: false,
    });
    expect(site.deployment).toBeUndefined();
    Annotations.fromStack(stack).hasWarning(
      "/Service/Docs",
      Match.stringLikeRegexp("does not exist; skipping"),
    );
    const template = Template.fromStack(stack);
    template.resourceCountIs("Custom::CDKBucketDeployment", 0);
    template.resourceCountIs("AWS::CloudFront::ResponseHeadersPolicy", 0);
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 404, ResponseCode: 404, ResponsePagePath: "/404.html" }),
        ]),
        Origins: Match.arrayWith([Match.objectLike({ DomainName: "api.example.com" })]),
      }),
    });
  });
});
