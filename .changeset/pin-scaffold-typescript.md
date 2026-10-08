---
"@rpallas/outcrop-cli": patch
---

`create account` and `create service` now install TypeScript 6.0. `typescript@latest` is 7, which ts-jest and typescript-eslint do not support yet, so `npm install` failed. Generated `tsconfig.json` files use `Node16` module resolution, because TypeScript 6 rejects `Node10`.
