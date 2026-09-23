# Testing

Services scaffolded by the CLI ship three test layers.

## Unit

Handler and library code with mocked AWS SDK clients (`aws-sdk-client-mock`). Runs on every push with no AWS access.

## Snapshot

`infra/tests/*.snapshot.test.ts` synthesises the stack for base and preview contexts and compares the CloudFormation template. The shared serializer normalises asset hashes. Run `npm run test:snapshot:update` after intentional infrastructure changes.

## Integration

`app/tests/integration/` runs against a deployed preview stack. `service-preview-deploy.yml` writes every stack output to environment variables named `<SERVICE>_OUTPUT_<Key>` (for example `ORDERS_OUTPUT_ApiBaseUrl`) before invoking `integration-test-command`.

## Library tests

Every construct in this repository has assertion tests using `aws-cdk-lib/assertions`. The kitchen-sink stack in `packages/outcrop/test/kitchen-sink.test.ts` is snapshot tested and checked with `cdk-nag` (AwsSolutions pack).
