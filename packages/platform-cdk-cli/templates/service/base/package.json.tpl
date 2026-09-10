{
  "name": "{{service}}",
  "version": "0.1.0",
  "private": true,
  "description": "{{service}} service built with platform-cdk",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "build": "tsc --noEmit",
    "lint": "eslint . && prettier --check .",
    "lint:fix": "eslint . --fix && prettier --write .",
    "test": "jest --selectProjects unit snapshot",
    "test:unit": "jest --selectProjects unit",
    "test:snapshot": "jest --selectProjects snapshot",
    "test:snapshot:update": "jest --selectProjects snapshot -u",
    "test:integration": "jest --selectProjects integration",
    "synth": "cdk synth -c env=dev",
    "synth:preview": "cdk synth -c env=dev -c preview=true -c previewId=local-1",
    "deploy:dev": "cdk deploy --all -c env=dev",
    "cdk": "cdk"
  },
  "dependencies": {},
  "devDependencies": {}
}
