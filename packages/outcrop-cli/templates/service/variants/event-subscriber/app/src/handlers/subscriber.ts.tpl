import { getLogger, withEventHandler } from "@rpallas/outcrop-runtime";

/** Shape of the event bodies this service subscribes to; refine per event name. */
interface ExampleEventBody {
  id: string;
  [key: string]: unknown;
}

/**
 * EventBridge subscriber. Events are `PlatformEvent` envelopes published by
 * other services with `publishEvent`; large bodies are transparently fetched
 * from S3. Throwing lets EventBridge retry and finally dead-letter the event.
 */
export const handler = withEventHandler<ExampleEventBody>((envelope) => {
  const logger = getLogger();
  // Make the function `async` once a case awaits something.
  switch (envelope.eventName) {
    case "example.created":
      logger.info("example created", { id: envelope.eventBody.id });
      break;
    case "example.updated":
      logger.info("example updated", { id: envelope.eventBody.id });
      break;
    default:
      logger.warn("unhandled event", { eventName: envelope.eventName });
  }
  return Promise.resolve();
});
