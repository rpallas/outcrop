# Decisions

Record service-level architecture decisions here. Platform-wide decisions live in the platform-cdk repository (`docs/adr`).

## 0001: Generated with platform-cdk

- Variants: http-api, dynamodb
- Auth: none
- Preview stacks deploy to `dev` with the id derived from the branch ticket reference (fallback `pr-<n>`).
