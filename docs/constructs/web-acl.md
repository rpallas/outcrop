# PlatformWebAcl

WAFv2 web ACL with the AWS managed baseline.

## Defaults

- `AWSManagedRulesCommonRuleSet`, `AWSManagedRulesKnownBadInputsRuleSet`, `AWSManagedRulesAmazonIpReputationList` (each can be disabled)
- Rate limit rule: 2000 requests per 5 minutes per IP (`rateLimit`, or `false`)
- CloudWatch metrics and sampled requests on, default action allow
- Scope `REGIONAL`; `PlatformWebAcl.forDistribution()` creates a `CLOUDFRONT` ACL and throws unless the stack targets us-east-1

## Where it can be attached

- `PlatformRestApi` stages: `acl.associate(api.deploymentStage)` or the `webAcl` prop
- `PlatformDistribution`: pass `webAclId: acl.webAclArn` from a us-east-1 stack
- **Not HTTP APIs**: WAFv2 does not support API Gateway HTTP APIs (`PlatformHttpApi`). Put a `PlatformDistribution` in front if WAF is required.

## Alarms

`alarms.blockedRequests()` (> 100 per 5 minutes).

## Example

```ts
const firewall = new PlatformWebAcl(this, "Firewall", { rateLimit: 1000 });
const admin = new PlatformRestApi(this, "Admin", { webAcl: firewall });
firewall.alarms.blockedRequests();
```
