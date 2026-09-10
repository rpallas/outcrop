export const ALERT_SEVERITIES = ["critical", "high", "medium", "low"] as const;

/**
 * Alert severity. Each severity maps to one SNS topic per environment so that
 * routing (pager, chat channel, email digest) is an account-level decision.
 */
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const isAlertSeverity = (value: string): value is AlertSeverity =>
  (ALERT_SEVERITIES as readonly string[]).includes(value);
