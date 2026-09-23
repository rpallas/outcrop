# SSM contract

The account baseline writes, the constructs read. Paths are rooted at `ssmRootPrefix` (default `/platform`). See ADR 0003 for the full list.

## Reading in CDK

```ts
const params = PlatformStack.of(this).params;
params.env.dnsZoneId(); // context lookup, needed at synth
params.env.certificateArn(); // context lookup
params.env.alertTopicArn("high"); // deploy-time token
params.account.kmsKeyArn(); // deploy-time token
```

## Reading at runtime

```ts
import { platformParams } from "@rpallas/outcrop-runtime";
const busName = await platformParams().env("dev").eventBusName();
```

## Adding a key

1. Add the path builder to `PlatformParameterPaths` in `packages/outcrop/src/params/paths.ts`.
2. Add the writer in the relevant `outcrop-account` module.
3. Add the reader to `PlatformParameters` and `platformParams()`.
4. Document it in ADR 0003.
