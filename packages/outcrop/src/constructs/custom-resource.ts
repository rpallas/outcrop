import { CustomResource, type CustomResourceProps, Duration } from "aws-cdk-lib";
import type { PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { Provider } from "aws-cdk-lib/custom-resources";
import type { Construct } from "constructs";
import { PlatformStack } from "../core/platform-stack";
import { PlatformFunction, type PlatformFunctionProps } from "./function";

export interface PlatformCustomResourceProps<TProps extends Record<string, unknown>> extends Omit<
  CustomResourceProps,
  "serviceToken" | "properties" | "resourceType"
> {
  /** Resource type; must start with `Custom::`. */
  readonly resourceType: `Custom::${string}`;
  /** Typed properties passed to the handler. */
  readonly properties: TProps;
  /** Handler function; use `PlatformCustomResource.handler()` to create one from an entry file. */
  readonly onEvent: IFunction;
  /** Optional isComplete handler for asynchronous resources. */
  readonly isComplete?: IFunction;
  readonly queryInterval?: Duration;
  readonly totalTimeout?: Duration;
}

export interface CustomResourceHandlerProps extends Omit<PlatformFunctionProps, "logging"> {
  /** IAM statements the handler needs. */
  readonly policyStatements?: PolicyStatement[];
}

/**
 * Base for custom resources: one shared Provider per stack and handler, with
 * provider framework log groups that follow the platform retention policy.
 */
export class PlatformCustomResource<
  TProps extends Record<string, unknown> = Record<string, unknown>,
> extends CustomResource {
  /** Create a handler function for a custom resource provider. */
  static handler(
    scope: Construct,
    id: string,
    props: CustomResourceHandlerProps,
  ): PlatformFunction {
    const { policyStatements, ...fnProps } = props;
    const fn = new PlatformFunction(scope, id, {
      timeout: Duration.minutes(5),
      memorySize: 512,
      ...fnProps,
    });
    for (const statement of policyStatements ?? []) fn.addToRolePolicy(statement);
    return fn;
  }

  /** Get or create the shared provider for a handler within its stack. */
  static providerFor(
    onEvent: IFunction,
    isComplete?: IFunction,
    options: { queryInterval?: Duration; totalTimeout?: Duration } = {},
  ): Provider {
    const stack = PlatformStack.of(onEvent);
    const key = `PlatformProvider-${onEvent.node.id}${isComplete ? `-${isComplete.node.id}` : ""}`;
    const existing = stack.node.tryFindChild(key);
    if (existing instanceof Provider) return existing;
    const logGroup = new LogGroup(stack, `${key}LogGroup`, {
      retention: stack.logRetention,
      removalPolicy: stack.removalPolicy,
    });
    return new Provider(stack, key, {
      onEventHandler: onEvent,
      ...(isComplete ? { isCompleteHandler: isComplete } : {}),
      ...(options.queryInterval ? { queryInterval: options.queryInterval } : {}),
      ...(options.totalTimeout ? { totalTimeout: options.totalTimeout } : {}),
      logGroup,
    });
  }

  readonly provider: Provider;

  constructor(scope: Construct, id: string, props: PlatformCustomResourceProps<TProps>) {
    const {
      onEvent,
      isComplete,
      properties,
      resourceType,
      queryInterval,
      totalTimeout,
      ...resourceProps
    } = props;
    const provider = PlatformCustomResource.providerFor(onEvent, isComplete, {
      ...(queryInterval ? { queryInterval } : {}),
      ...(totalTimeout ? { totalTimeout } : {}),
    });
    super(scope, id, {
      ...resourceProps,
      resourceType,
      serviceToken: provider.serviceToken,
      properties,
    });
    this.provider = provider;
  }
}

/** Shape of the event a custom resource handler receives, typed by its properties. */
export interface CustomResourceEvent<
  TProps extends Record<string, unknown> = Record<string, unknown>,
> {
  RequestType: "Create" | "Update" | "Delete";
  ResourceType: string;
  LogicalResourceId: string;
  PhysicalResourceId?: string;
  ResourceProperties: TProps & { ServiceToken: string };
  OldResourceProperties?: TProps & { ServiceToken: string };
}

/** Shape of the response a custom resource handler returns. */
export interface CustomResourceResponse<
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  PhysicalResourceId?: string;
  Data?: TData;
  NoEcho?: boolean;
}
