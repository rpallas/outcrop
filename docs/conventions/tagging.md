# Tagging

`PlatformStack` applies these tags to every resource in the stack:

- `platform:project` - `config.project`
- `platform:service` - `config.service`
- `platform:env` - environment name
- `platform:preview-id` - preview id, only on preview stacks
- `platform:managed-by` - `platform-cdk`

Plus any `config.tags` entries. Alarms additionally carry `platform:severity`.

Account baseline stacks tag with `platform:component` (for example `github-oidc`, `dns`, `alerting`).
