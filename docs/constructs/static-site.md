# PlatformStaticSite

Private S3 bucket + CloudFront distribution + deployment of a built site.

## Defaults

- `PlatformBucket` behind origin access control, redirect to HTTPS, caching optimised, compression
- Security headers response policy (HSTS with preload, nosniff, `DENY` framing, strict referrer policy, XSS protection); `contentSecurityPolicy` adds a CSP
- `spa: true` serves `/index.html` with status 200 for 403/404; `errorDocument` serves a 404 page otherwise
- `BucketDeployment` from `sourcePath` with pruning and a `/*` invalidation; when the directory does not exist the deployment is skipped with a synth warning
- Domain, logs and outputs as in [`PlatformDistribution`](./distribution.md)

## Props highlights

| Prop              | Purpose                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiOrigin`       | `{ api: HttpApi \| url, pathPattern }` forwards a path (unchanged) to an API origin with caching disabled and all viewer headers except `Host` |
| `securityHeaders` | `false` or a custom `ResponseSecurityHeadersBehavior`                                                                                          |
| `invalidate`      | Skip the CloudFront invalidation                                                                                                               |

Exposes `bucket`, `distribution`, `deployment`, `url`.

## Example

```ts
const site = new PlatformStaticSite(this, "Site", {
  sourcePath: "web/dist",
  spa: true,
  apiOrigin: { api, pathPattern: "/api/*" },
});
```
