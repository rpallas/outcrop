# PlatformDistribution

CloudFront distribution wired to the platform domain and certificates.

## Defaults

- Custom domain `{service}.{envDomain}` (preview pattern in previews) using the us-east-1 certificate and hosted zone from the SSM contract, with A and AAAA alias records
- TLS 1.2 2021, SNI, HTTP/2 + HTTP/3, additional metrics published
- Access logs to a dedicated bucket outside previews (`accessLogs: false` or pass a bucket that allows ACLs)
- Comment from the platform naming; outputs `<Name>DomainName` and `<Name>Url`

## Props highlights

| Prop            | Purpose                                                     |
| --------------- | ----------------------------------------------------------- |
| `domain`        | `false` disables the domain, a string overrides it          |
| `domainPattern` | Naming pattern such as `assets-{service}.{envDomain}`       |
| `disableDomain` | Same as `domain: false`                                     |
| `webAclId`      | ARN of a `PlatformWebAcl.forDistribution()` ACL (us-east-1) |

## Alarms

`alarms.serverErrors()` (5xx rate > 1%), `alarms.clientErrors()` (4xx rate > 10%).

## Example

```ts
const cdn = new PlatformDistribution(this, "Assets", {
  defaultBehavior: { origin: S3BucketOrigin.withOriginAccessControl(bucket) },
  domainPattern: "assets-{service}.{envDomain}",
});
```
