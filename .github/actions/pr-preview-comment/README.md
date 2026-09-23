# pr-preview-comment

Creates or updates one sticky pull request comment (marker `<!-- outcrop-preview -->`) with
the preview status, preview id, stack names, URL, a link to the workflow run and a timestamp.

Requires `permissions: pull-requests: write`. Silently skips when there is no pull request number.

## Usage

```yaml
- uses: rpallas/outcrop/.github/actions/pr-preview-comment@v1
  with:
    status: deployed
    preview-id: ${{ steps.preview.outputs.preview-id }}
    stack-names: ${{ steps.deploy.outputs.stack-names }}
    base-url: ${{ steps.base.outputs.base-url }}
- if: failure()
  uses: rpallas/outcrop/.github/actions/pr-preview-comment@v1
  with:
    status: failed
    preview-id: ${{ steps.preview.outputs.preview-id }}
```

| Input            | Default                            | Description                                     |
| ---------------- | ---------------------------------- | ----------------------------------------------- |
| `status`         | required                           | `deployed`, `destroyed`, `failed` or `skipped`. |
| `preview-id`     | `""`                               | Preview id.                                     |
| `stack-names`    | `""`                               | Comma separated stack names.                    |
| `base-url`       | `""`                               | Preview URL (shown when deployed).              |
| `extra-markdown` | `""`                               | Extra markdown appended to the comment.         |
| `pr-number`      | `github.event.pull_request.number` | Pull request number.                            |
| `github-token`   | `github.token`                     | Token with `pull-requests: write`.              |

| Output       | Description                          |
| ------------ | ------------------------------------ |
| `comment-id` | Id of the created / updated comment. |
