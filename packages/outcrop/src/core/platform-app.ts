import { App, type AppProps } from "aws-cdk-lib";
import type { IConstruct } from "constructs";
import { type PlatformContext, resolvePlatformContext } from "../config/context";
import type { PlatformConfig } from "../config/schema";
import { PlatformNaming } from "../naming/naming";
import { PlatformParameterPaths } from "../params/paths";

export interface PlatformAppProps extends AppProps {
  /** Validated platform config, usually the default export of `platform.config.ts`. */
  readonly config: PlatformConfig;
}

const PLATFORM_APP_SYMBOL = Symbol.for("@rpallas/outcrop.PlatformApp");

/**
 * CDK `App` that resolves the platform context (`env`, `preview`, `previewId`)
 * once and shares config, naming and parameter paths with every `PlatformStack`.
 */
export class PlatformApp extends App {
  /** Find the PlatformApp at the root of a construct tree, if there is one. */
  static tryOf(scope: IConstruct): PlatformApp | undefined {
    const root = scope.node.root;
    return PLATFORM_APP_SYMBOL in root ? (root as unknown as PlatformApp) : undefined;
  }

  static override of(scope: IConstruct): PlatformApp {
    const app = PlatformApp.tryOf(scope);
    if (!app) {
      throw new Error(
        "Construct is not inside a PlatformApp. Create your app with `new PlatformApp({ config })`.",
      );
    }
    return app;
  }

  readonly config: PlatformConfig;
  readonly context: PlatformContext;
  readonly naming: PlatformNaming;
  readonly paths: PlatformParameterPaths;

  constructor(props: PlatformAppProps) {
    super(props);
    Object.defineProperty(this, PLATFORM_APP_SYMBOL, { value: true, enumerable: false });
    this.config = props.config;
    this.context = resolvePlatformContext(this, props.config);
    this.naming = createNaming(this.context);
    this.paths = new PlatformParameterPaths(props.config.ssmRootPrefix);
  }
}

export const createNaming = (context: PlatformContext): PlatformNaming =>
  new PlatformNaming({
    service: context.config.service,
    env: context.env,
    isolation: context.config.isolation,
    previewId: context.previewId,
    envDomain: context.envDomain,
    domainPattern: context.config.preview.domainPattern,
  });
