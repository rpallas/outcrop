# cdk-deploy

Runs `cdk deploy --require-approval <x> --outputs-file <file> --progress events --concurrency 4 -c env=<env> [...] --all`
and uploads the outputs JSON as the artifact `cdk-outputs-<env>[-<preview-id>]`.

For previews (`preview: "true"`) the context `-c preview=true -c previewId=<id> -c prNumber=<n>` is
added; the app derives `<preview-id>-` prefixed stack names, so `--all` is the normal choice.

AWS credentials must already be configured (use `aws-oidc-login`).

## Usage

```yaml
- id: deploy
  uses: rpallas/platform-cdk/.github/actions/cdk-deploy@v1
  with:
    env: dev
    preview: "true"
    preview-id: ${{ steps.preview.outputs.preview-id }}
```

| Input               | Default                            | Description                                   |
| ------------------- | ---------------------------------- | --------------------------------------------- |
| `working-directory` | `.`                                | CDK app directory.                            |
| `env`               | required                           | `-c env=<env>`.                               |
| `preview`           | `false`                            | Preview deployment.                           |
| `preview-id`        | `""`                               | Required when `preview` is `true`.            |
| `pr-number`         | `github.event.pull_request.number` | `-c prNumber=<n>` for previews.               |
| `stacks`            | `--all`                            | Stack names/wildcards, comma/space separated. |
| `extra-context`     | `""`                               | Newline separated `key=value` context pairs.  |
| `extra-args`        | `""`                               | Extra `cdk deploy` arguments.                 |
| `require-approval`  | `never`                            | `--require-approval` value.                   |
| `outputs-file`      | `cdk-outputs.json`                 | Outputs JSON path (relative to app).          |
| `cdk-command`       | `npx cdk`                          | CDK CLI command.                              |

| Output          | Description                           |
| --------------- | ------------------------------------- |
| `outputs-file`  | Absolute path of the outputs JSON.    |
| `stack-names`   | Comma separated deployed stack names. |
| `artifact-name` | Name of the uploaded artifact.        |
