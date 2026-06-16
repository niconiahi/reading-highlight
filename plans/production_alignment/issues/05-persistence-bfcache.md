# 05 — IndexedDB persistence and bfcache lifecycle

Type: AFK
Triage: ready-for-agent

## Parent

`plans/production_alignment/PRD.md`

## What to build

Persist reader state across reloads and back-button navigations on `/production`. Two coupled pieces:

1. **IndexedDB-backed store** at `$lib/persistence`. Keyed by `document_id` (the route uses a static `document_id` for now — the bundled passage). Holds `{ position: number, rate: number, voice: string | null, manual_offset_ms: number, updated_at: number }`. Promise-based API. Ships with an in-memory fake implementing the same interface for tests.

2. **bfcache-compatible lifecycle.** `/production` does not register `beforeunload` or `unload` handlers. State is persisted on `pagehide`. On `pageshow` with `event.persisted === true`, the route re-reads `audio.currentTime` and re-syncs the rAF tick state (resets the hinted-search hint from slice 03).

Quota-exceeded and access-denied errors from IndexedDB do not throw. They emit a `persistence.degraded` telemetry event with `{ reason: string }` and the store transparently degrades to in-memory state. A user-visible toast surfaces the degraded state.

## Acceptance criteria

- [ ] `$lib/persistence` exports an async `read(document_id)`, `write(document_id, state)` API and an in-memory fake constructor.
- [ ] Unit tests against the in-memory fake cover read-after-write, partial updates, and the degraded-mode path.
- [ ] One Playwright integration test exercises real IndexedDB end-to-end (write, reload, read).
- [ ] `/production` writes state on `pagehide` and reads it on mount.
- [ ] `/production` re-syncs on `pageshow` with `event.persisted === true`: position from store, audio current time honored, hinted search hint reset.
- [ ] `/production` does not register `beforeunload` or `unload` listeners (grep-asserted in the codebase as a regression guard).
- [ ] Quota-exceeded path emits `persistence.degraded` telemetry and surfaces a toast; route continues to function in-memory.
- [ ] Playwright bfcache test: load route, advance audio, navigate to another route, hit back; assert position is preserved and audio is ready to resume.

## Blocked by

- 01 — bootstrap-route-extract-svg-overlay
- 02 — telemetry-sink-seam
