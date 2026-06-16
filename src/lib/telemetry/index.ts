export type LogPayload = Record<string, string | number | boolean>;

export type Logger = {
  event: (name: string, payload: LogPayload) => void;
};

export const logger: Logger = { event: () => {} };

export function set_logger(impl: Logger): void {
  logger.event = impl.event;
}
