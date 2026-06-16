import type { Logger, LogPayload } from '$lib/telemetry';

export type RecordedEvent = { name: string; payload: LogPayload };

export function create_recording_logger(): {
  logger: Logger;
  events: RecordedEvent[];
} {
  const events: RecordedEvent[] = [];
  return {
    events,
    logger: { event: (name, payload) => events.push({ name, payload }) },
  };
}
