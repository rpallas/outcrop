---
"@rpallas/outcrop-account": minor
"@rpallas/outcrop-cli": minor
---

Support GitHub's immutable OIDC subject claims.

GitHub repositories created after 15 July 2026 present `repo:<owner>@<owner-id>/<repo>@<repo-id>:...` as the token subject, so deploy and read-only roles that trusted `repo:<owner>/<repo>:...` rejected them.

- `@rpallas/outcrop-account`: `github` entries accept optional `ownerId` and `repoId`, which must be set together. When they're set, the repository's roles trust only the immutable subject. `oidcSubjectPrefix` is exported.
- `@rpallas/outcrop-cli`: the new `outcrop oidc-subject <owner>/<repo>` command uses the GitHub CLI to print a repository's subject prefix and the ids to add to `account.config.ts`. `create service` mentions it in its next steps.
