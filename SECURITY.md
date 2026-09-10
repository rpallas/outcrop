# Security policy

## Supported versions

Only the latest minor release of each `@rpallas/platform-cdk*` package receives security fixes.

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private vulnerability reporting on the repository ("Security" tab, "Report a vulnerability"). You will receive an acknowledgement within five working days.

## Secure defaults

The constructs in this repository default to:

- S3 buckets with public access blocked, TLS enforced and encryption at rest
- SQS queues with server-side encryption and TLS enforced
- DynamoDB point-in-time recovery for non-preview stacks
- Lambda functions with structured JSON logging and X-Ray tracing
- GitHub OIDC deploy roles that can only assume the CDK bootstrap roles
- No long-lived credentials anywhere in the workflows

Report any construct whose default weakens one of these guarantees as a security issue.
