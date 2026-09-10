# Preview model

See ADR 0004 for the decision; this page is the operational summary.

## Lifecycle

1. Pull request opened or updated: `service-preview-deploy.yml` computes the preview id, assumes the preview deploy role, runs `cdk deploy -c env=dev -c preview=true -c previewId=<id>`, writes stack outputs, posts a sticky comment with the URL and optionally runs integration tests.
2. Pull request closed: `service-preview-destroy.yml` destroys `<id>-<Service>` if it exists.
3. Label `skip-preview` disables step 1.

## Preview id

- Branch `feature/abc-123-add-thing` -> `abc-123`
- Branch `fix-typo` on PR 42 -> `pr-42`
- Configurable via `preview.idStrategy`: `ticket-then-pr` (default), `pr`, `branch-slug`

## What changes in a preview

- Removal policy `DESTROY`, buckets auto-delete, DynamoDB PITR off, log retention 7 days
- Hostname `{service}-{previewId}.{envDomain}`
- Tags `platform:preview-id`, `platform:pr-number`, `platform:repository`
