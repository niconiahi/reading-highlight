export type LogPayload = Record<string, string | number | boolean>;

export type Logger = {
  event: (name: string, payload: LogPayload) => void;
};

const no_op_logger: Logger = {
  event: () => {},
};

let current_logger: Logger = no_op_logger;

export function set_logger(impl: Logger): void {
  current_logger = impl;
}

export function get_logger(): Logger {
  return current_logger;
}

export const logger: Logger = {
  event: (name, payload) => current_logger.event(name, payload),
};
