import type { ScheduledEvent } from "aws-lambda";
import { getLogger, withHandler } from "@rpallas/platform-cdk-runtime";

/**
 * Scheduled job invoked by EventBridge Scheduler. Keep it idempotent: the
 * schedule may fire twice around deployments and retries.
 */
export const handler = withHandler<ScheduledEvent | Record<string, unknown>, { processed: number }>(async (event) => {
  const logger = getLogger();
  const scheduledAt = "time" in event ? String(event["time"]) : new Date().toISOString();
  logger.info("scheduled job started", { scheduledAt });

  // Replace with the real work, e.g. cleaning up expired items or sending digests.
  const processed = 0;

  logger.info("scheduled job finished", { processed });
  return { processed };
});
