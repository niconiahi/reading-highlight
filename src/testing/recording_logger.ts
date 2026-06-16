import type { Logger, LogPayload } from '$lib/telemetry';

export function create_recording_logger() {
  const events: { name: string; payload: LogPayload }[] = [];
  const logger: Logger = { event: (name, payload) => { events.push({ name, payload }); } };
  return { logger, events };
}
