# 03 — Telemetry: singleton `logger.event`, drop `sink` DI from every module

Type: AFK
Triage: ready-for-agent

## Parent

`plans/improvements/PRD.md`

## What to build

The current telemetry seam is dependency-injection in shape only. Every module — `attach_media_session`, `attach_latency_measurement`, `attach_scroll_controller`, the persistence layer, the highlight renderer — takes a `sink: Sink` parameter and threads it down call by call. The sink itself is installed once in the route via `set_telemetry_sink(create_otel_console_sink())` and read back via a `getContext`-backed `get_telemetry_sink()`. There is no second implementation in production; the DI exists exclusively so tests can substitute a recording sink. The cost is a `sink` parameter in every `attach_*` / `create_*` config and a parallel set of `emit_*(sink, ...)` one-liner wrappers in `$lib/telemetry/index.ts`.

Replace the DI with a singleton. Expose a `logger` object from `$lib/telemetry` with a single method `event(name, payload)`. Every module imports `logger` directly and calls `logger.event('playback.drift_sample', {...})` inline. The `emit_*` wrappers are deleted. Tests call `set_logger(recording)` once in their setup and `get_logger()` returns the test double; production calls `set_logger(otel_console_logger)` once on mount in `+page.svelte`. The `sink` constructor parameter is removed from every module.

All currently-emitted events stay. No event is added or removed — this is a refactor of the seam, not of the event surface.

## Acceptance criteria

- [x] `$lib/telemetry/index.ts` exports `logger` (with `event(name, payload)`), `set_logger(impl)`, `get_logger()`, and a `create_recording_logger()` helper for tests.
- [x] `$lib/telemetry/otel_console_sink.ts` is renamed/refactored to `otel_console_logger.ts` (or equivalent) and conforms to the new shape.
- [x] Every `emit_*(sink, ...)` one-liner wrapper is deleted; callsites use `logger.event(name, payload)` inline.
- [x] No `attach_*` or `create_*` module config in `$lib/` contains a `sink` key.
- [x] `+page.svelte` calls `set_logger(otel_console_logger)` once at module init (browser-guarded) and no longer threads `telemetry` into any constructor.
- [x] Tests that previously created a `create_recording_sink()` and passed it in now call `set_logger(create_recording_logger())` in `beforeEach` and assert against the recorder's events.
- [x] `npx vitest run` is green. Every test that previously asserted on emitted events still asserts on them via the recorder.
- [x] No event name in `$lib/` has changed; all existing emitted events still fire with the same payload shape.

## Blocked by

None — can start immediately.
