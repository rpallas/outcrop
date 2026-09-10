# setup-node-project

Installs Node.js with the npm cache enabled and runs a reproducible `npm ci`.

- Node.js version: `node-version` input, else `<working-directory>/.nvmrc`, else `./.nvmrc`, else `24`.
- Cache: `actions/setup-node@v4` with `cache: npm`, keyed on `**/package-lock.json` below the
  working directory.
- Install: `npm ci --ignore-scripts` by default. Set `allow-install-scripts: "true"` only when a
  dependency genuinely needs lifecycle scripts.

## Usage

```yaml
- uses: rpallas/platform-cdk/.github/actions/setup-node-project@v1
  with:
    working-directory: .
```

| Input                   | Default | Description                                             |
| ----------------------- | ------- | ------------------------------------------------------- |
| `node-version`          | `""`    | Explicit Node.js version; empty means use `.nvmrc`.     |
| `working-directory`     | `.`     | Directory containing `package-lock.json`.               |
| `install`               | `true`  | Run `npm ci`.                                           |
| `allow-install-scripts` | `false` | Allow npm lifecycle scripts during install.             |
| `registry-url`          | `""`    | Optional registry URL (auth via `NODE_AUTH_TOKEN` env). |

| Output         | Description                           |
| -------------- | ------------------------------------- |
| `node-version` | Installed version (`node --version`). |
