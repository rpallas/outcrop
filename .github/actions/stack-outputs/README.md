# stack-outputs

Exports CloudFormation stack outputs as environment variables / step outputs named
`<prefix><OutputKey>` (keys sanitised to `[A-Za-z0-9_]`).

Sources, in order of preference:

1. `@rpallas/outcrop-cli stack-outputs --stack ... --json <file>` when `cli-command` or
   `cli-version` is set (falls back when the CLI is unavailable).
2. The `cdk deploy --outputs-file` JSON (`outputs-file` input).
3. `aws cloudformation describe-stacks` for each of `stack-names`.

## Usage

```yaml
- id: outputs
  uses: rpallas/outcrop/.github/actions/stack-outputs@v1
  with:
    outputs-file: ${{ steps.deploy.outputs.outputs-file }}
    prefix: PREVIEW_
- run: curl --fail "$PREVIEW_ApiBaseUrl/health"
```

| Input               | Default | Description                                    |
| ------------------- | ------- | ---------------------------------------------- |
| `outputs-file`      | `""`    | `cdk deploy --outputs-file` JSON.              |
| `stack-names`       | `""`    | Comma separated stack names (AWS CLI / CLI).   |
| `prefix`            | `""`    | Key prefix, e.g. `PREVIEW_`.                   |
| `export-env`        | `true`  | Write to `$GITHUB_ENV`.                        |
| `export-output`     | `true`  | Write to `$GITHUB_OUTPUT`.                     |
| `cli-version`       | `""`    | CLI version for `npx --yes` (enables CLI use). |
| `cli-command`       | `""`    | Explicit CLI command (enables CLI use).        |
| `working-directory` | `.`     | Directory the CLI runs from.                   |

| Output         | Description                                   |
| -------------- | --------------------------------------------- |
| `outputs-json` | Single-line JSON object of all exported keys. |
| `count`        | Number of outputs.                            |
