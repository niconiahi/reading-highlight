import { SeverityNumber, logs } from '@opentelemetry/api-logs';
import {
  ConsoleLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { Logger } from './index';

let initialized = false;

function ensure_provider(): void {
  if (initialized) return;
  const provider = new LoggerProvider({
    resource: resourceFromAttributes({
      'service.name': 'reading-highlight',
      'service.namespace': 'production-route',
    }),
    processors: [
      new SimpleLogRecordProcessor(new ConsoleLogRecordExporter()),
    ],
  });
  logs.setGlobalLoggerProvider(provider);
  initialized = true;
}

export function create_otel_console_logger(): Logger {
  ensure_provider();
  const otel_logger = logs.getLogger('production-route', '0.0.0');
  return {
    event: (name, payload) => {
      otel_logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: 'INFO',
        body: name,
        attributes: { 'event.name': name, ...payload },
      });
    },
  };
}
