import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { CliError, type Io } from "../io";

export const OIDC_SUBJECT_HELP = `Usage: outcrop oidc-subject <owner>/<repo>

Prints the OIDC subject claim prefix GitHub Actions uses for a repository and,
when it uses the immutable format (the default for repositories created after
15 July 2026), the ownerId/repoId to add to its entry in account.config.ts.

Uses the GitHub CLI (gh), so it works for private repositories you can access.`;

export interface OidcSubjectDeps {
  /** Runs `gh api <path>` and returns the response body. */
  readonly ghApi: (path: string) => string;
}

const defaultDeps: OidcSubjectDeps = {
  ghApi: (path) => execFileSync("gh", ["api", path], { encoding: "utf8" }),
};

interface SubjectCustomization {
  readonly sub_claim_prefix?: string;
}

const IMMUTABLE_PREFIX = /^repo:([^@/]+)@(\d+)\/([^@/]+)@(\d+)$/;

export const oidcSubjectCommand = (
  argv: string[],
  io: Io,
  deps: OidcSubjectDeps = defaultDeps,
): number => {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { help: { type: "boolean", short: "h" } },
    allowPositionals: true,
  });
  if (values.help) {
    io.out(OIDC_SUBJECT_HELP);
    return 0;
  }
  const [slug] = positionals;
  const [owner, repo, ...rest] = (slug ?? "").split("/");
  if (!owner || !repo || rest.length > 0) {
    throw new CliError(`expected <owner>/<repo>\n\n${OIDC_SUBJECT_HELP}`);
  }

  let body: string;
  try {
    body = deps.ghApi(`repos/${owner}/${repo}/actions/oidc/customization/sub`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(
      `could not read the OIDC subject of ${owner}/${repo} with the GitHub CLI (gh): ${message}`,
    );
  }
  const prefix = (JSON.parse(body) as SubjectCustomization).sub_claim_prefix;
  if (!prefix) throw new CliError(`GitHub returned no sub_claim_prefix for ${owner}/${repo}`);

  io.out(`Subject prefix: ${prefix}`);
  io.out(`Example:        ${prefix}:environment:dev`);
  const match = IMMUTABLE_PREFIX.exec(prefix);
  if (!match) {
    io.out("");
    io.out("This repository uses the name-based format; no ids are needed in account.config.ts.");
    return 0;
  }
  const [, , ownerId, , repoId] = match;
  io.out("");
  io.out(
    "This repository uses the immutable format. Add the ids to its entry in account.config.ts:",
  );
  io.out(`  { owner: "${owner}", repo: "${repo}", ownerId: ${ownerId}, repoId: ${repoId} }`);
  return 0;
};
