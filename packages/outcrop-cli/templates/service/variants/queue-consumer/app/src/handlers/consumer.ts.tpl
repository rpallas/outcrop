import type { SQSRecord } from "aws-lambda";
import { getLogger, withSqsHandler } from "@rpallas/outcrop-runtime";

const logger = getLogger();

interface Job {
  id: string;
  type: string;
}

const parseJob = (body: string): Job => {
  const value: unknown = JSON.parse(body);
  if (typeof value !== "object" || value === null) throw new Error("job must be an object");
  const { id, type } = value as Partial<Job>;
  if (typeof id !== "string" || typeof type !== "string") throw new Error("job needs string id and type");
  return { id, type };
};

/**
 * Processes one SQS record. Throwing marks only this record as failed
 * (partial batch responses), so the rest of the batch is not retried.
 */
export const processRecord = async (record: SQSRecord): Promise<void> => {
  const job = parseJob(record.body);
  logger.info("processing job", { jobId: job.id, jobType: job.type });
  await Promise.resolve();
};

export const handler = withSqsHandler(processRecord);
