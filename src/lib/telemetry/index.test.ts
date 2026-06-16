import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { logger, set_logger } from './index';
import { create_recording_logger } from '$testing/recording_logger';

describe('telemetry singleton logger', () => {
  beforeEach(() => {
    set_logger({ event: () => {} });
  });

  afterEach(() => {
    set_logger({ event: () => {} });
  });

  test('default logger.event never throws', () => {
    expect(() => logger.event('any.event', { a: 1, b: 'two', c: true }))
      .not.toThrow();
  });

  test('recording logger captures emitted events in order with full payloads', () => {
    const { logger: rec, events } = create_recording_logger();
    set_logger(rec);
    logger.event('a.b', { x: 1 });
    logger.event('c.d', { y: 'two', z: true });
    expect(events).toEqual([
      { name: 'a.b', payload: { x: 1 } },
      { name: 'c.d', payload: { y: 'two', z: true } },
    ]);
  });

  test('logger.event delegates to the currently-installed logger', () => {
    const { logger: rec, events } = create_recording_logger();
    set_logger(rec);
    logger.event('route.mounted', { route: '/' });
    expect(events).toEqual([{ name: 'route.mounted', payload: { route: '/' } }]);
  });
});
