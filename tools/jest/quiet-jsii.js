// Quieted before any test file imports aws-cdk-lib. The warnings come from
// jsii structs inside the CDK (TableV2 grant props, CfnEventBusPolicy.principal),
// and each one prints a full stack trace.
process.env.JSII_DEPRECATED = "quiet";
