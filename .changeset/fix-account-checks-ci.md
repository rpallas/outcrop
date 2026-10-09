---
"@rpallas/outcrop-cli": patch
---

Scaffolded projects now pass their own `npm run lint` straight after `create`:

- `create account` installs `eslint`, `@eslint/js`, `typescript-eslint` and `eslint-config-prettier`. The scaffolded `lint` script and `eslint.config.mjs` use them, but they weren't installed, so lint failed with `eslint: not found`.
- `create account` and `create service` format the files they write with the project's own Prettier after installing dependencies. Rendered templates and the generated service stack didn't match the scaffolded Prettier config.
- The service templates no longer trip `@typescript-eslint/require-await` or `no-unnecessary-type-assertion`. The in-memory HTTP store now has the same async interface as the DynamoDB repository.
