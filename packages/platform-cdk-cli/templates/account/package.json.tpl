{
  "name": "{{name}}",
  "version": "0.1.0",
  "private": true,
  "description": "Account baseline for {{project}} built with platform-cdk",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "build": "tsc --noEmit",
    "lint": "eslint . && prettier --check .",
    "lint:fix": "eslint . --fix && prettier --write .",
    "test": "jest",
    "test:update": "jest -u",
    "synth": "cdk synth --all -c env=dev",
    "diff:dev": "cdk diff --all -c env=dev",
    "deploy:dev": "cdk deploy --all -c env=dev",
    "cdk": "cdk"
  },
  "devDependencies": {}
}
