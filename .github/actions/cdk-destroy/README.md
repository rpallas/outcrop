# cdk-destroy

Destroys the stacks of a CDK app with `cdk destroy --force`.

1. `cdk list` (same context) resolves the stack names the app defines.
2. `aws cloudformation describe-stacks` checks which of them exist.
3. Only existing stacks are destroyed; when none exist the action prints `nothing to destroy` and
   sets `destroyed=false`.

AWS credentials must already be configured (use `aws-oidc-login`).

## Usage

```yaml
- uses: rpallas/outcrop/.github/actions/cdk-destroy@v1
  with:
    env: dev
    preview: "true"
    preview-id: ${{ steps.preview.outputs.preview-id }}
```

| Input               | Default   | Description                                   |
| ------------------- | --------- | --------------------------------------------- |
| `working-directory` | `.`       | CDK app directory.                            |
| `env`               | required  | `-c env=<env>`.                               |
| `preview`           | `false`   | Preview environment.                          |
| `preview-id`        | `""`      | Required when `preview` is `true`.            |
| `stacks`            | `--all`   | Stack names/wildcards, comma/space separated. |
| `extra-context`     | `""`      | Newline separated `key=value` context pairs.  |
| `cdk-command`       | `npx cdk` | CDK CLI command.                              |

| Output        | Description                            |
| ------------- | -------------------------------------- |
| `destroyed`   | `true` / `false`.                      |
| `stack-names` | Comma separated destroyed stack names. |
