# cdk-diff-comment

Runs `cdk diff --no-color -c env=<env> [...] --all` and posts the output in a collapsible sticky
pull request comment (marker `<!-- outcrop-diff -->`). Output longer than `max-chars`
(default 60000) is truncated with a note. A non-zero `cdk diff` exit code (differences found) never
fails the job.

Requires AWS credentials (a read-only role is enough) and `permissions: pull-requests: write`.

## Usage

```yaml
- uses: rpallas/outcrop/.github/actions/aws-oidc-login@v1
  with:
    role-arn: ${{ vars.AWS_READONLY_ROLE_ARN_DEV }}
    aws-region: ${{ vars.AWS_REGION }}
- uses: rpallas/outcrop/.github/actions/cdk-diff-comment@v1
  with:
    env: dev
```

| Input               | Default                            | Description                                   |
| ------------------- | ---------------------------------- | --------------------------------------------- |
| `working-directory` | `.`                                | CDK app directory.                            |
| `env`               | required                           | `-c env=<env>`.                               |
| `stacks`            | `--all`                            | Stack names/wildcards, comma/space separated. |
| `extra-context`     | `""`                               | Newline separated `key=value` context pairs.  |
| `cdk-command`       | `npx cdk`                          | CDK CLI command.                              |
| `max-chars`         | `60000`                            | Truncation limit for the comment.             |
| `pr-number`         | `github.event.pull_request.number` | Pull request number.                          |
| `github-token`      | `github.token`                     | Token with `pull-requests: write`.            |

| Output       | Description                          |
| ------------ | ------------------------------------ |
| `exit-code`  | Exit code of `cdk diff`.             |
| `diff-file`  | Path of the captured diff output.    |
| `comment-id` | Id of the created / updated comment. |
