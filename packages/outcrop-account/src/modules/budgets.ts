import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import type { ITopic } from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";
import type { BaselineModuleProps } from "./base";

export interface BudgetsProps extends BaselineModuleProps {
  /** Monthly cost budget in USD. Defaults to `environment.monthlyBudgetUsd`. */
  readonly monthlyUsd?: number;
  /** Actual-spend thresholds (percent) that trigger a notification. Default [80, 100]. */
  readonly actualThresholds?: number[];
  /** Forecasted-spend thresholds (percent). Default [100]. */
  readonly forecastThresholds?: number[];
  /** SNS topic to notify (e.g. `alerting.topic("high")`). */
  readonly topic?: ITopic;
  /** Email addresses to notify. Defaults to `environment.alertEmails`. */
  readonly emails?: string[];
}

/** Monthly cost budget with actual and forecast notifications to SNS and email. */
export class Budgets extends Construct {
  readonly budget: CfnBudget;

  constructor(scope: Construct, id: string, props: BudgetsProps) {
    super(scope, id);
    const { context } = props;
    const amount = props.monthlyUsd ?? context.environment.monthlyBudgetUsd;
    if (amount === undefined)
      throw new Error(
        `no budget amount: set environments.${context.env}.monthlyBudgetUsd or pass monthlyUsd`,
      );
    const emails = props.emails ?? context.environment.alertEmails;
    const subscribers: CfnBudget.SubscriberProperty[] = [
      ...(props.topic ? [{ subscriptionType: "SNS", address: props.topic.topicArn }] : []),
      ...emails.map((address) => ({ subscriptionType: "EMAIL", address })),
    ];
    if (subscribers.length === 0)
      throw new Error("budgets need at least one subscriber (topic or emails)");

    const notification = (
      type: "ACTUAL" | "FORECASTED",
      threshold: number,
    ): CfnBudget.NotificationWithSubscribersProperty => ({
      notification: {
        notificationType: type,
        comparisonOperator: "GREATER_THAN",
        threshold,
        thresholdType: "PERCENTAGE",
      },
      subscribers,
    });

    this.budget = new CfnBudget(this, "Monthly", {
      budget: {
        budgetName: `${context.config.project}-${context.env}-monthly`,
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount, unit: "USD" },
      },
      notificationsWithSubscribers: [
        ...(props.actualThresholds ?? [80, 100]).map((t) => notification("ACTUAL", t)),
        ...(props.forecastThresholds ?? [100]).map((t) => notification("FORECASTED", t)),
      ],
    });
  }
}
