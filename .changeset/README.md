# Changesets

This repository uses [changesets](https://github.com/changesets/changesets) to version and publish packages.

- Run `npm run changeset` after making a change to a published package and describe it.
- All `@rpallas/outcrop*` packages are in a single `fixed` group, so they always share a version number.
- On `main`, the release workflow opens a "Version Packages" pull request. Merging it publishes to npm with provenance and moves the floating `v1` tag used by reusable workflow consumers.
