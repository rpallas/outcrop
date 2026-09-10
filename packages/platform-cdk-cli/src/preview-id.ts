/**
 * Preview id derivation. This is a CDK-free copy of the rules in
 * `@rpallas/platform-cdk` (`config/preview-id.ts`) so that CI, the CLI and the
 * CDK app agree without the CLI depending on aws-cdk-lib. Keep both in sync.
 */
export const PREVIEW_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const PREVIEW_ID_MAX_LENGTH = 20;
export type PreviewIdStrategy = "ticket-then-pr" | "pr" | "branch-slug";
export const PREVIEW_ID_STRATEGIES: readonly PreviewIdStrategy[] = [
  "ticket-then-pr",
  "pr",
  "branch-slug",
];

const TICKET_RE = /(?<![a-z0-9])([a-z]{2,10})[-_](\d{1,6})(?![a-z0-9])/i;

export const isValidPreviewId = (value: string): boolean =>
  PREVIEW_ID_RE.test(value) && value.length <= PREVIEW_ID_MAX_LENGTH;

export const assertValidPreviewId = (value: string): string => {
  if (!isValidPreviewId(value)) {
    throw new Error(
      `previewId "${value}" is invalid: expected lowercase letters, digits and single hyphens, starting with a letter, at most ${PREVIEW_ID_MAX_LENGTH} characters`,
    );
  }
  return value;
};

export const ticketFromBranch = (branch: string): string | undefined => {
  const match = TICKET_RE.exec(branch);
  const prefix = match?.[1];
  const number = match?.[2];
  if (!prefix || !number) return undefined;
  return `${prefix.toLowerCase()}-${number}`;
};

export const branchSlug = (branch: string): string => {
  const slug = branch
    .toLowerCase()
    .replace(/^refs\/heads\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "");
  const trimmed = slug.slice(0, PREVIEW_ID_MAX_LENGTH).replace(/-+$/g, "");
  return trimmed.length > 0 ? trimmed : "branch";
};

export interface PreviewIdSource {
  branch?: string | undefined;
  prNumber?: number | string | undefined;
}

export const derivePreviewId = (
  source: PreviewIdSource,
  strategy: PreviewIdStrategy = "ticket-then-pr",
): string => {
  const pr =
    source.prNumber !== undefined && source.prNumber !== "" ? `pr-${source.prNumber}` : undefined;
  const branch = source.branch?.trim();
  switch (strategy) {
    case "pr": {
      if (!pr) throw new Error("preview id strategy 'pr' requires a pull request number");
      return assertValidPreviewId(pr);
    }
    case "branch-slug": {
      if (!branch) throw new Error("preview id strategy 'branch-slug' requires a branch name");
      return assertValidPreviewId(branchSlug(branch));
    }
    case "ticket-then-pr": {
      const ticket = branch ? ticketFromBranch(branch) : undefined;
      if (ticket && isValidPreviewId(ticket)) return ticket;
      if (pr) return assertValidPreviewId(pr);
      throw new Error(
        "could not derive a preview id: branch has no ticket reference and no pull request number was given",
      );
    }
  }
};
