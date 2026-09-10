/** `my-handler-v2` -> `MyHandlerV2`. Used to derive output keys and construct ids. */
export const pascal = (value: string): string =>
  value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
