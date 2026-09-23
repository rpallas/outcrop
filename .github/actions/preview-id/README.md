# preview-id

Derives the preview environment id for a pull request.

Rules (identical in the CLI and the bash fallback):

1. Lowercase the branch name.
2. `ticket-then-pr` (default): the first `letters[-_]digits` token (2-10 letters, 1-6 digits, not
   glued to other alphanumerics) becomes `letters-digits`, e.g. `feature/ABC-123-thing` ->
   `abc-123`. Without a ticket the id is `pr-<number>`.
3. `pr`: always `pr-<number>`.
4. `branch-slug`: slugified branch name (non-alphanumerics become `-`, leading non-letters are
   dropped, cut to 20 characters).
5. The result must match `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` and be at most 20 characters.

The CLI (`npx --yes @rpallas/outcrop-cli@<cli-version> preview-id ...`, or `cli-command` when
set) is tried first; when it is unavailable or returns nothing usable the bash fallback is used.

## Usage

```yaml
- id: preview
  uses: rpallas/outcrop/.github/actions/preview-id@v1
- run: echo "${{ steps.preview.outputs.preview-id }}"
```

| Input               | Default                                | Description                            |
| ------------------- | -------------------------------------- | -------------------------------------- |
| `branch`            | `github.head_ref \|\| github.ref_name` | Branch name.                           |
| `pr-number`         | `github.event.pull_request.number`     | PR number.                             |
| `strategy`          | `ticket-then-pr`                       | `ticket-then-pr`, `pr`, `branch-slug`. |
| `cli-version`       | `latest`                               | CLI version for `npx --yes`.           |
| `cli-command`       | `""`                                   | Explicit CLI command (local build).    |
| `working-directory` | `.`                                    | Directory the CLI runs from.           |

| Output         | Description              |
| -------------- | ------------------------ |
| `preview-id`   | e.g. `abc-123`, `pr-42`. |
| `stack-prefix` | `<preview-id>-`.         |
| `source`       | `cli` or `bash`.         |
