# PlatformEmailIdentity

SES domain identity for sending email from the service domain.

## Defaults

- Domain: the service hostname (`{service}.{envDomain}`); `domain` overrides it
- Easy DKIM with CNAME records in the environment hosted zone (`createDnsRecords: false` to manage DNS elsewhere; the domain must be inside the zone)
- `mailFrom: true` sets `mail.<domain>` as the custom MAIL FROM domain and creates the MX and SPF records
- Configuration set with reputation metrics and TLS required (or pass `configurationSet`)

## Helpers

`grantSend(grantee, fromAddresses?)` allows `ses:SendEmail`, `ses:SendRawEmail` and `ses:SendTemplatedEmail` on the identity and configuration set, optionally restricted with a `ses:FromAddress` condition.

## Alarms

`alarms.bounceRate()` (> 5%), `alarms.complaintRate()` (> 0.1%).

## Example

```ts
const mail = new PlatformEmailIdentity(this, "Mail", { mailFrom: true });
mail.grantSend(handler, ["no-reply@orders.dev.example.com"]);
mail.alarms.bounceRate();
```
