name: Checks

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  checks:
    uses: rpallas/outcrop/.github/workflows/service-checks.yml@v1
    with:
      synth-command: npx cdk synth --all -c env=dev
