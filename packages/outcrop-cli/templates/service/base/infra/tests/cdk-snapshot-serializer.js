/** Normalises asset hashes so CloudFormation snapshots are stable across machines. */
const HASH_RE = /[0-9a-f]{64}/g;

const normalise = (value) => {
  if (typeof value === "string") return value.replace(HASH_RE, "<ASSET_HASH>");
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k.startsWith("aws:asset:") ? "<ASSET>" : normalise(v),
      ]),
    );
  }
  return value;
};

module.exports = {
  test: (value) =>
    value && typeof value === "object" && "Resources" in value && !value.__normalised,
  serialize: (value, config, indentation, depth, refs, printer) => {
    const out = normalise(value);
    Object.defineProperty(out, "__normalised", { value: true, enumerable: false });
    return printer(out, config, indentation, depth, refs);
  },
};
