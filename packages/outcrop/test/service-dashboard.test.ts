import { Template } from "aws-cdk-lib/assertions";
import { AttributeType } from "aws-cdk-lib/aws-dynamodb";
import { isDashboardContributor, serviceDashboard } from "../src/alerting/service-dashboard";
import { PlatformFunction } from "../src/constructs/function";
import { PlatformQueue } from "../src/constructs/queue";
import { PlatformTable } from "../src/constructs/table";
import { HANDLER_ENTRY, testStack } from "./fixtures";

describe("serviceDashboard", () => {
  it("adds a row per platform construct and an alarm row", () => {
    const stack = testStack();
    const fn = new PlatformFunction(stack, "Handler", { entry: HANDLER_ENTRY });
    const queue = new PlatformQueue(stack, "Jobs", { deadLetterQueue: true });
    new PlatformTable(stack, "Orders", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
    });
    fn.alarms.errors();
    queue.alarms.dlqDepth();

    const dashboard = serviceDashboard(stack, { name: "service" });
    expect(isDashboardContributor(fn)).toBe(true);
    expect(isDashboardContributor(dashboard)).toBe(false);

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::CloudWatch::Dashboard", {
      DashboardName: "orders-service",
    });
    const dashboards = template.findResources("AWS::CloudWatch::Dashboard");
    const body = JSON.stringify(Object.values(dashboards)[0]);
    expect(body).toContain("# orders (dev)");
    expect(body).toContain("Function handler: invocations");
    expect(body).toContain("Queue jobs: messages");
    expect(body).toContain("Table orders: capacity");
    expect(body).toContain('\\"type\\":\\"alarm\\"');
  });

  it("supports filtering and disabling the alarm row", () => {
    const stack = testStack();
    new PlatformFunction(stack, "Handler", { entry: HANDLER_ENTRY });
    new PlatformQueue(stack, "Jobs");
    serviceDashboard(stack, {
      alarms: false,
      title: "# Custom",
      filter: (c) => c instanceof PlatformQueue,
    });
    const body = JSON.stringify(
      Template.fromStack(stack).findResources("AWS::CloudWatch::Dashboard"),
    );
    expect(body).toContain("# Custom");
    expect(body).toContain("Queue jobs");
    expect(body).not.toContain("Function handler");
    expect(body).not.toContain('\\"type\\":\\"alarm\\"');
  });
});
