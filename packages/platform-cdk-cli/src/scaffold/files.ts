import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderTemplate, type TemplateVars } from "./template";

export interface CopyOptions {
  /** Overwrite existing files. Default false (existing files are skipped and reported). */
  readonly force?: boolean;
  /** Only report what would be written. */
  readonly dryRun?: boolean;
}

export interface CopyResult {
  readonly written: string[];
  readonly skipped: string[];
}

/** Files whose names start with `_` are renamed to `.` (e.g. `_gitignore` -> `.gitignore`) so templates survive npm publish. */
const outputName = (name: string): string => {
  let out = name.endsWith(".tpl") ? name.slice(0, -4) : name;
  if (out.startsWith("_")) out = `.${out.slice(1)}`;
  return out;
};

/** Recursively copy a template directory, rendering `.tpl` files. */
export const copyTemplateDir = (
  sourceDir: string,
  targetDir: string,
  vars: TemplateVars,
  options: CopyOptions = {},
  result: CopyResult = { written: [], skipped: [] },
): CopyResult => {
  for (const entry of readdirSync(sourceDir)) {
    const source = path.join(sourceDir, entry);
    const target = path.join(targetDir, renderTemplate(outputName(entry), vars));
    if (statSync(source).isDirectory()) {
      copyTemplateDir(source, target, vars, options, result);
      continue;
    }
    const content = entry.endsWith(".tpl")
      ? renderTemplate(readFileSync(source, "utf8"), vars)
      : readFileSync(source);
    writeFile(target, content, options, result);
  }
  return result;
};

export const writeFile = (
  target: string,
  content: string | Buffer,
  options: CopyOptions,
  result: CopyResult,
): void => {
  if (existsSync(target) && !options.force) {
    result.skipped.push(target);
    return;
  }
  if (!options.dryRun) {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  result.written.push(target);
};

/** Locate the CLI's bundled `templates` directory (works from src via ts-jest and from dist). */
export const templatesRoot = (): string => {
  const candidates = [
    path.join(__dirname, "..", "..", "templates"),
    path.join(__dirname, "..", "..", "..", "templates"),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`templates directory not found (looked in ${candidates.join(", ")})`);
  return found;
};

/** Locate the CLI's bundled `skills` directory. */
export const skillsRoot = (): string => {
  const candidates = [
    path.join(__dirname, "..", "..", "skills"),
    path.join(__dirname, "..", "..", "..", "skills"),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`skills directory not found (looked in ${candidates.join(", ")})`);
  return found;
};
