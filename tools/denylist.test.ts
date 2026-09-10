import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Guards the repository against accidentally committing organisation-specific
 * or sensitive values. Only placeholder values are permitted:
 *  - AWS account ids: 111111111111 ... 999999999999 (repeated digits) or 123456789012
 *  - Domains: example.com / example.org / example.net (+ subdomains), and the
 *    AWS/GitHub/npm service domains used by the tooling itself
 *  - Organisation / OU ids: o-example*, ou-example*, r-example*
 *  - Emails: *@example.com
 */
const repoRoot = path.resolve(__dirname, "..");

const trackedFiles = (): string[] =>
  execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter((file) => file.length > 0)
    .filter((file) => !file.endsWith("package-lock.json"))
    .filter((file) => !file.startsWith("tools/denylist"))
    .filter((file) => !/\.(png|jpg|jpeg|gif|ico|woff2?|zip)$/i.test(file));

const ALLOWED_ACCOUNT_IDS = new Set([
  "111111111111",
  "222222222222",
  "333333333333",
  "444444444444",
  "555555555555",
  "666666666666",
  "777777777777",
  "888888888888",
  "999999999999",
  "000000000000",
  "123456789012",
]);

const ALLOWED_HOSTS = [
  /(^|\.)example\.(com|org|net)$/,
  /(^|\.)amazonaws\.com$/,
  /(^|\.)amazon\.com$/,
  /(^|\.)aws\.amazon\.com$/,
  /(^|\.)github\.com$/,
  /(^|\.)githubusercontent\.com$/,
  /(^|\.)npmjs\.(com|org)$/,
  /(^|\.)nodejs\.org$/,
  /(^|\.)typescriptlang\.org$/,
  /(^|\.)jestjs\.io$/,
  /(^|\.)eslint\.org$/,
  /(^|\.)prettier\.io$/,
  /(^|\.)neon\.tech$/,
  /(^|\.)slack\.com$/,
  /(^|\.)office\.com$/,
  /(^|\.)microsoft\.com$/,
  /(^|\.)webhook\.office\.com$/,
  /(^|\.)auth0\.com$/,
  /(^|\.)opensource\.org$/,
  /(^|\.)choosealicense\.com$/,
  /(^|\.)contributor-covenant\.org$/,
  /(^|\.)keepachangelog\.com$/,
  /(^|\.)semver\.org$/,
  /(^|\.)conventionalcommits\.org$/,
  /(^|\.)docs\.aws\.amazon\.com$/,
  /(^|\.)schemastore\.org$/,
  /(^|\.)json-schema\.org$/,
  /(^|\.)mozilla\.org$/,
  /(^|\.)w3\.org$/,
  /(^|\.)rfc-editor\.org$/,
  /(^|\.)wikipedia\.org$/,
  /(^|\.)datatracker\.ietf\.org$/,
  /(^|\.)ietf\.org$/,
  /(^|\.)zod\.dev$/,
  /(^|\.)git\.io$/,
  /(^|\.)unpkg\.com$/,
  /(^|\.)renovatebot\.com$/,
  /(^|\.)typedoc\.org$/,
  /(^|\.)vitepress\.dev$/,
  /(^|\.)docusaurus\.io$/,
  /(^|\.)esbuild\.github\.io$/,
  /(^|\.)changesets\.dev$/,
  /(^|\.)localhost$/,
];

const FORBIDDEN_SUBSTRINGS = ["codeartifact", "bitbucket", "datadog", "pagerduty", "launchdarkly"];

const HOST_RE = /\b(?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|tv|uk|co\.uk|tech|app|cloud)\b/gi;
const ACCOUNT_ID_RE = /\b\d{12}\b/g;
const ORG_ID_RE = /\b(o-[a-z0-9]{10,32}|ou-[a-z0-9]{4,32}-[a-z0-9]{8,32}|r-[a-z0-9]{4,32})\b/g;
const EMAIL_RE = /\b[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})\b/gi;
const WEBHOOK_RE =
  /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+|https:\/\/[a-z0-9.-]+\.webhook\.office\.com\/webhookb2\/[^\s"']+/gi;

interface Violation {
  file: string;
  line: number;
  value: string;
  reason: string;
}

const isAllowedHost = (host: string): boolean =>
  ALLOWED_HOSTS.some((pattern) => pattern.test(host.toLowerCase()));

const isAllowedOrgId = (id: string): boolean => /^(o|ou|r)-example/.test(id);

const scan = (file: string, contents: string): Violation[] => {
  const violations: Violation[] = [];
  contents.split("\n").forEach((line, index) => {
    const lineNumber = index + 1;
    const lower = line.toLowerCase();

    for (const substring of FORBIDDEN_SUBSTRINGS) {
      if (lower.includes(substring)) {
        violations.push({
          file,
          line: lineNumber,
          value: substring,
          reason: "forbidden vendor/tool reference",
        });
      }
    }
    for (const match of line.matchAll(ACCOUNT_ID_RE)) {
      if (!ALLOWED_ACCOUNT_IDS.has(match[0])) {
        violations.push({
          file,
          line: lineNumber,
          value: match[0],
          reason: "non-placeholder AWS account id",
        });
      }
    }
    for (const match of line.matchAll(ORG_ID_RE)) {
      if (!isAllowedOrgId(match[0])) {
        violations.push({
          file,
          line: lineNumber,
          value: match[0],
          reason: "non-placeholder Organizations id",
        });
      }
    }
    for (const match of line.matchAll(EMAIL_RE)) {
      const domain = match[1] ?? "";
      if (!isAllowedHost(domain)) {
        violations.push({
          file,
          line: lineNumber,
          value: match[0],
          reason: "non-placeholder email address",
        });
      }
    }
    for (const match of line.matchAll(WEBHOOK_RE)) {
      violations.push({ file, line: lineNumber, value: match[0], reason: "webhook URL" });
    }
    for (const match of line.matchAll(HOST_RE)) {
      const host = match[0];
      // Skip things that are clearly file names or package specifiers.
      if (/\.(ts|js|mjs|cjs|json|md|yml|yaml|test|config|d|spec|snap|tpl)$/i.test(host)) continue;
      if (/^(www\.)?(index|package|tsconfig|jest|eslint)\./i.test(host)) continue;
      if (!isAllowedHost(host)) {
        violations.push({ file, line: lineNumber, value: host, reason: "non-placeholder domain" });
      }
    }
  });
  return violations;
};

describe("repository denylist", () => {
  it("contains no organisation-specific or sensitive values", () => {
    const violations = trackedFiles().flatMap((file) => {
      const absolute = path.join(repoRoot, file);
      try {
        return scan(file, readFileSync(absolute, "utf8"));
      } catch {
        return [];
      }
    });
    const report = violations.map((v) => `${v.file}:${v.line} ${v.reason}: ${v.value}`).join("\n");
    expect(report).toBe("");
  });
});
