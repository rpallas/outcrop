/** `MyHandlerV2` -> `my-handler-v2`. Used to derive short names from construct ids. */
export const kebab = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase()
    .replace(/^-+|-+$/g, "");
