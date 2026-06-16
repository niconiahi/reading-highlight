# 02 — Telemetry sink seam (no-op default, recording fake for tests)

Type: AFK
Triage: ready-for-agent

## Parent

`plans/production_alignment/PRD.md`

## What to build

Introduce a `$lib/telemetry` module exposing a `Sink` interface with a single `emit(event_name, payload)` method, a no-op default implementation, and a recording fake for tests. Provide the sink to the `/production` route via Svelte context so subsequent slices can grab it without prop-drilling.

This slice is the seam, not the events. It ships with one demo event — `route.mounted` emitted on `/production` page mount — to prove the path is wired. Subsequent slices add their own events (drift, paint latency, click-to-seek, media error, tts fallback) against this seam.

Event payloads are primitive-only (numbers, strings, booleans). No DOM nodes, no full passages, no PII. The recording fake stores emitted events in a plain array for assertion.

Decision shape (from PRD):

```ts
type Sink = { emit: (event: string, payload: Record<string, string | number | boolean>) => void };
```

## Acceptance criteria

- [ ] `$lib/telemetry` exports a `Sink` type, a `no_op_sink`, and a `create_recording_sink()` factory that returns `{ sink, events }`.
- [ ] `/production` reads the sink from Svelte context and emits `route.mounted` on mount.
- [ ] A unit test using `create_recording_sink` asserts `route.mounted` is emitted exactly once when the route is rendered.
- [ ] The default sink is the no-op; the route does not crash if no sink is provided in context.
- [ ] No telemetry code lands in `/speechify/range-rects` — this seam is `/production`-only for now.

## Blocked by

- 01 — bootstrap-route-extract-svg-overlay
