import { type IAlarm, type IMetric, type IWidget, GraphWidget } from "aws-cdk-lib/aws-cloudwatch";
import type { IConstruct } from "constructs";
import type { PlatformStack } from "../core/platform-stack";
import { PlatformAlarm } from "./alarm";
import { DASHBOARD_ROW_WIDTH, PlatformDashboard, type PlatformDashboardProps } from "./dashboard";

/**
 * Implemented by every platform construct that can describe itself on a
 * dashboard. `serviceDashboard` discovers contributors by duck typing so the
 * alerting module does not depend on the construct implementations.
 */
export interface DashboardContributor {
  /** Short name used for row titles. */
  readonly shortName: string;
  /** One row of widgets (widths should add up to `DASHBOARD_ROW_WIDTH`). */
  dashboardWidgets(): IWidget[];
}

/** A metric group rendered as one graph widget. */
export interface MetricWidgetGroup {
  readonly title: string;
  readonly left: IMetric[];
  readonly right?: IMetric[];
}

/** Type guard for constructs that implement `DashboardContributor`. */
export const isDashboardContributor = (
  construct: IConstruct,
): construct is IConstruct & DashboardContributor => {
  const candidate = construct as Partial<DashboardContributor>;
  return (
    typeof candidate.dashboardWidgets === "function" && typeof candidate.shortName === "string"
  );
};

/** Build a row of graph widgets that share the dashboard width evenly. */
export const metricWidgets = (groups: MetricWidgetGroup[], height = 6): IWidget[] => {
  const width = Math.max(Math.floor(DASHBOARD_ROW_WIDTH / Math.max(groups.length, 1)), 1);
  return groups.map(
    (group) =>
      new GraphWidget({
        title: group.title,
        left: group.left,
        ...(group.right ? { right: group.right } : {}),
        width,
        height,
      }),
  );
};

export interface ServiceDashboardProps extends PlatformDashboardProps {
  /** Markdown title for the first row. Default `# {service} ({env})`. */
  readonly title?: string;
  /** Add an alarm status row with every `PlatformAlarm` in the stack. Default true. */
  readonly alarms?: boolean;
  /** Only include constructs for which this returns true. */
  readonly filter?: (construct: IConstruct & DashboardContributor) => boolean;
}

/**
 * Build a dashboard for a whole stack by walking its construct tree and adding
 * one row per platform construct (functions, APIs, queues, tables, state
 * machines, topics, distributions, event rules...). Call it at the end of the
 * stack constructor so every construct is already in the tree.
 */
export const serviceDashboard = (
  stack: PlatformStack,
  props: ServiceDashboardProps = {},
): PlatformDashboard => {
  const { title, alarms, filter, ...dashboardProps } = props;
  const dashboard = new PlatformDashboard(stack, "ServiceDashboard", dashboardProps);
  dashboard.addHeader(title ?? `# ${stack.config.service} (${stack.envName})`);

  const contributors = stack.node
    .findAll()
    .filter(isDashboardContributor)
    .filter((c) => (filter ? filter(c) : true));
  for (const contributor of contributors) {
    dashboard.addRow(...contributor.dashboardWidgets());
  }

  if (alarms ?? true) {
    const found: IAlarm[] = stack.node.findAll().filter((c) => c instanceof PlatformAlarm);
    dashboard.addAlarmRow("Alarms", found);
  }
  return dashboard;
};
