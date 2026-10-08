/**
 * Versions that must not float. `typescript@latest` is 7, but ts-jest and
 * typescript-eslint only accept TypeScript below 7, so `npm install` fails in a
 * scaffolded project. Keep this in step with the repo's own `typescript`.
 */
const PINNED: Readonly<Record<string, string>> = {
  typescript: "~6.0.3",
};

/** Version range written into package.json. */
export const packageVersion = (name: string, platformVersion: string): string => {
  if (name.startsWith("@rpallas/")) return platformVersion;
  return PINNED[name] ?? "latest";
};

/** Spec passed to `npm install`, e.g. `typescript@~6.0.3`. */
export const packageSpec = (name: string, platformVersion: string): string =>
  `${name}@${packageVersion(name, platformVersion)}`;
