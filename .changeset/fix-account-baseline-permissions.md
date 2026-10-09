---
"@rpallas/outcrop-account": patch
"@rpallas/outcrop-cli": patch
---

Fix two account baseline permission bugs:

- `AccountSettings`: the S3 Block Public Access custom resource now grants `s3:PutAccountPublicAccessBlock`. It previously granted `s3:PutPublicAccessBlock`, which doesn't exist at account level, so the first deploy failed with AccessDenied.
- `create account`: the scaffolded `checks.yml` now grants `id-token: write` and `pull-requests: write`, which the reusable `service-checks.yml` workflow requires. Without them the workflow failed with `startup_failure`.
