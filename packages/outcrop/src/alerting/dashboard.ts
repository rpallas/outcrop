import {
  AlarmStatusWidget,
  Dashboard,
  type DashboardProps,
  GraphWidget,
  type IAlarm,
  type IMetric,
  type IWidget,
  TextWidget,
} from "aws-cdk-lib/aws-cloudwatch";
import type { Construct } from "constructs";
import { PlatformStack } from "../core/platform-stack";

export interface PlatformDashboardProps extends Omit<DashboardProps, "dashboardName"> {
  /** Short name; defaults to the service name. */
  readonly name?: string;
}

export const DASHBOARD_ROW_WIDTH = 24;

/**
 * CloudWatch dashboard with a row-oriented API. Each `addRow` call becomes one
 * full-width row; widgets without an explicit width share the row evenly.
 */
export class PlatformDashboard extends Dashboard {
  constructor(scope: Construct, id: string, props: PlatformDashboardProps = {}) {
    const stack = PlatformStack.of(scope);
    const { name, ...dashboardProps } = props;
    super(scope, id, {
      ...dashboardProps,
      dashboardName: stack.naming.resource("dashboard", name ?? "overview"),
    });
  }

  /** Add a row of widgets. */
  addRow(...widgets: IWidget[]): this {
    if (widgets.length === 0) return this;
    this.addWidgets(...widgets);
    return this;
  }

  /** Add a markdown header row. */
  addHeader(markdown: string, height = 1): this {
    return this.addRow(new TextWidget({ markdown, width: DASHBOARD_ROW_WIDTH, height }));
  }

  /** Add a row with one graph per metric group. */
  addMetricRow(groups: { title: string; left: IMetric[]; right?: IMetric[] }[], height = 6): this {
    const width = Math.max(Math.floor(DASHBOARD_ROW_WIDTH / Math.max(groups.length, 1)), 1);
    return this.addRow(
      ...groups.map(
        (g) =>
          new GraphWidget({
            title: g.title,
            left: g.left,
            ...(g.right ? { right: g.right } : {}),
            width,
            height,
          }),
      ),
    );
  }

  /** Add an alarm status row. */
  addAlarmRow(title: string, alarms: IAlarm[], height = 3): this {
    if (alarms.length === 0) return this;
    return this.addRow(
      new AlarmStatusWidget({ title, alarms, width: DASHBOARD_ROW_WIDTH, height }),
    );
  }
}
