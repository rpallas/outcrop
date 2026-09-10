import { createHash } from "node:crypto";
import { type ResourceKind, type ResourceKindRule, ruleFor } from "./resource-kind";

export type OverflowStrategy = "hashTail" | "truncateEnd";

export interface PlatformNamingProps {
  readonly service: string;
  readonly env: string;
  readonly isolation: "account" | "shared";
  readonly previewId?: string | undefined;
  readonly envDomain?: string | undefined;
  readonly domainPattern?: string | undefined;
  readonly overflow?: OverflowStrategy | undefined;
}

export interface ResourceNameOptions {
  /** Override the overflow strategy for this name. */
  readonly overflow?: OverflowStrategy;
  /** Skip the platform prefix (previewId/env/service) and only sanitise the given name. */
  readonly bare?: boolean;
}

export const HASH_LENGTH = 7;

/** Stable short hash used to keep truncated names unique. */
export const shortHash = (value: string, length: number = HASH_LENGTH): string =>
  createHash("sha256").update(value).digest("hex").slice(0, length);

const collapse = (value: string, separator: string): string => {
  const escaped = separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value
    .replace(new RegExp(`${escaped}{2,}`, "g"), separator)
    .replace(new RegExp(`^${escaped}+|${escaped}+$`, "g"), "");
};

export const sanitise = (value: string, rule: ResourceKindRule): string => {
  const lowered = rule.lowercase ? value.toLowerCase() : value;
  return collapse(lowered.replace(rule.allowed, rule.separator), rule.separator);
};

export const applyOverflow = (
  value: string,
  rule: ResourceKindRule,
  strategy: OverflowStrategy,
  hashSource: string = value,
): string => {
  if (value.length <= rule.maxLength) return value;
  if (strategy === "truncateEnd") {
    return collapse(value.slice(0, rule.maxLength), rule.separator);
  }
  const hash = shortHash(hashSource);
  const headLength = rule.maxLength - hash.length - rule.separator.length;
  const head = collapse(value.slice(0, Math.max(headLength, 1)), rule.separator);
  return `${head}${rule.separator}${hash}`;
};

export const toPascalCase = (value: string): string =>
  value
    .split(/[^a-zA-Z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

/**
 * Produces every physical name in a platform stack.
 *
 * Segments: `[previewId?] [env when isolation=shared] service name`, joined with
 * the resource kind's separator, sanitised and shortened per kind.
 */
export class PlatformNaming {
  readonly service: string;
  readonly env: string;
  readonly isolation: "account" | "shared";
  readonly previewId: string | undefined;
  readonly envDomain: string | undefined;
  readonly domainPattern: string;
  readonly overflow: OverflowStrategy;

  constructor(props: PlatformNamingProps) {
    this.service = props.service;
    this.env = props.env;
    this.isolation = props.isolation;
    this.previewId = props.previewId;
    this.envDomain = props.envDomain;
    this.domainPattern = props.domainPattern ?? "{service}-{previewId}.{envDomain}";
    this.overflow = props.overflow ?? "hashTail";
  }

  get isPreview(): boolean {
    return this.previewId !== undefined;
  }

  /** Prefix segments in order, without the resource name. */
  segments(): string[] {
    const parts: string[] = [];
    if (this.previewId) parts.push(this.previewId);
    if (this.isolation === "shared") parts.push(this.env);
    parts.push(this.service);
    return parts;
  }

  /** Joined prefix, e.g. `abc-123-orders`. */
  prefix(separator = "-"): string {
    return this.segments().join(separator);
  }

  /** Physical name for a resource of the given kind. */
  resource(kind: ResourceKind, name: string, options: ResourceNameOptions = {}): string {
    const rule = ruleFor(kind);
    const parts = options.bare ? [name] : [...this.segments(), name];
    const joined = parts
      .map((part) => sanitise(part, rule))
      .filter((part) => part.length > 0)
      .join(rule.separator);
    return applyOverflow(
      joined,
      rule,
      options.overflow ?? this.overflow,
      parts.join(rule.separator),
    );
  }

  /**
   * Stack name: PascalCase service (plus optional PascalCase suffix), prefixed by
   * previewId and suffixed by env for shared isolation, e.g. `abc-123-Orders`,
   * `Orders-dev`, `Orders-Api`.
   */
  stack(name?: string): string {
    const rule = ruleFor("stack");
    const base = toPascalCase(name ? `${this.service}-${name}` : this.service);
    const parts: string[] = [];
    if (this.previewId) parts.push(this.previewId);
    parts.push(base);
    if (this.isolation === "shared") parts.push(this.env);
    const joined = parts.map((part) => sanitise(part, rule)).join(rule.separator);
    return applyOverflow(joined, rule, "hashTail");
  }

  /**
   * Fully qualified hostname for the service. Base deployments use
   * `{service}.{envDomain}`; previews render `domainPattern`. Returns undefined
   * when the environment has no domain.
   */
  domain(pattern?: string): string | undefined {
    if (!this.envDomain) return undefined;
    const template = pattern ?? (this.isPreview ? this.domainPattern : "{service}.{envDomain}");
    const rendered = template
      .replace(/\{service\}/g, this.service)
      .replace(/\{previewId\}/g, this.previewId ?? "")
      .replace(/\{env\}/g, this.env)
      .replace(/\{envDomain\}/g, this.envDomain);
    return rendered
      .split(".")
      .map((label) => sanitise(label, ruleFor("dnsLabel")))
      .filter((label) => label.length > 0)
      .join(".");
  }

  /** Name for a CloudFormation export, unique per stack. */
  exportName(name: string): string {
    return `${this.stack()}:${sanitise(name, ruleFor("generic"))}`;
  }

  /** SSM parameter path segment for this service, e.g. `/platform/services/orders`. */
  servicePath(rootPrefix: string): string {
    const parts = [rootPrefix.replace(/\/$/, ""), "services", ...this.segments()];
    return parts.join("/");
  }

  /** Return a copy of this naming with the resource name overflow strategy changed. */
  withOverflow(overflow: OverflowStrategy): PlatformNaming {
    return new PlatformNaming({
      service: this.service,
      env: this.env,
      isolation: this.isolation,
      previewId: this.previewId,
      envDomain: this.envDomain,
      domainPattern: this.domainPattern,
      overflow,
    });
  }
}
