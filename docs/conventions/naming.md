# Naming

All physical names go through `PlatformNaming` (`@rpallas/outcrop`). See ADR 0002.

## Segments

`[previewId?] [env if isolation=shared] service name`

Examples for service `orders`, name `handler`:

- account isolation, base deploy: `orders-handler`
- account isolation, preview `abc-123`: `abc-123-orders-handler`
- shared isolation, env `dev`: `dev-orders-handler`
- shared isolation, preview `pr-42` into `dev`: `pr-42-dev-orders-handler`

Stack names use the PascalCase service: `Orders`, `abc-123-Orders`, `Orders-dev`.

## Resource kinds

`ResourceKind` carries the maximum length and character rules for each AWS resource type. When a name is too long the `hashTail` strategy trims the head and appends `-<7 char hash>` computed from the full name, so the result is deterministic.

## Domains

`naming.domain(pattern?)` renders the configured `preview.domainPattern` (default `{service}-{previewId}.{envDomain}`) for previews and `{service}.{envDomain}` for base deployments. Keep the preview pattern to a single label below `envDomain` so the environment wildcard certificate covers it.
