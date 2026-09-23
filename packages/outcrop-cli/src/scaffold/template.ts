export type TemplateVars = Record<string, string | boolean | undefined>;

const IF_BLOCK = /\{\{#(if|unless) ([a-zA-Z0-9_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
const VAR = /\{\{([a-zA-Z0-9_]+)\}\}/g;

/**
 * Tiny mustache-like renderer: `{{var}}`, `{{#if flag}}...{{/if}}`,
 * `{{#unless flag}}...{{/unless}}`. Blocks may nest one level deep by running
 * the block regex until no more blocks match. Unknown variables throw so
 * templates never ship placeholders.
 */
export const renderTemplate = (content: string, vars: TemplateVars): string => {
  let result = content;
  let previous: string;
  do {
    previous = result;
    result = result.replace(IF_BLOCK, (_match, kind: string, name: string, body: string) => {
      const value = vars[name];
      const truthy = value !== undefined && value !== false && value !== "";
      const show = kind === "if" ? truthy : !truthy;
      return show ? body.replace(/^\n/, "") : "";
    });
  } while (result !== previous);

  return result.replace(VAR, (_match, name: string) => {
    const value = vars[name];
    if (value === undefined) {
      throw new Error(`template variable "${name}" is not defined`);
    }
    return typeof value === "boolean" ? String(value) : value;
  });
};

export const toPascalCase = (value: string): string =>
  value
    .split(/[^a-zA-Z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

export const toCamelCase = (value: string): string => {
  const pascal = toPascalCase(value);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
};

export const toConstantCase = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toUpperCase();
