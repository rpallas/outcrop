# examples/account-baseline

Reference account baseline app using `@rpallas/platform-cdk-account`. It is the output of

```sh
npx @rpallas/platform-cdk-cli create account example-platform \
  --project example-platform --owner example-org --domain example.com
```

with the per-repository tooling replaced by this monorepo's shared configuration; the CLI
test-suite keeps the generated files identical to this example.

- `account.config.ts` - two environments (`dev`, `prod`) with placeholder account ids
- `lib/modules.ts` - every baseline module enabled with defaults
- `bin/app.ts` - `createAccountBaseline(app, { config, modules })`
- `test/baseline.test.ts` - snapshot per environment and deploy role assertions

```sh
npm test -w examples/account-baseline
cd examples/account-baseline && npx cdk synth --all -c env=dev
```
