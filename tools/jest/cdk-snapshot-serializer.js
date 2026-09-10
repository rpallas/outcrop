/**
 * Jest snapshot serializer that normalises volatile values in synthesised
 * CloudFormation templates so snapshots stay stable across machines and
 * dependency bumps:
 *  - Lambda/asset S3 keys and hashes (64 hex chars)
 *  - CDK bootstrap version parameter defaults
 *  - `aws:cdk:path` and `Metadata` asset paths
 */
const HASH_RE = /[0-9a-f]{64}/g;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalise(value) {
  if (typeof value === "string") {
    return value.replace(HASH_RE, "<ASSET_HASH>");
  }
  if (Array.isArray(value)) {
    return value.map(normalise);
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "aws:asset:path" || key === "aws:asset:original-path") {
        out[key] = "<ASSET_PATH>";
      } else {
        out[key] = normalise(entry);
      }
    }
    return out;
  }
  return value;
}

function looksLikeTemplate(value) {
  return (
    isPlainObject(value) &&
    (typeof value.Resources === "object" || "AWSTemplateFormatVersion" in value)
  );
}

module.exports = {
  test(value) {
    return looksLikeTemplate(value) && !value.__normalised;
  },
  serialize(value, config, indentation, depth, refs, printer) {
    const normalised = normalise(value);
    Object.defineProperty(normalised, "__normalised", { value: true, enumerable: false });
    return printer(normalised, config, indentation, depth, refs);
  },
};
