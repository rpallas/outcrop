name: Checks

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  checks:
    uses: rpallas/platform-cdk/.github/workflows/service-checks.yml@v1
    with:
      synth-command: npx cdk synth --all -c env=dev
