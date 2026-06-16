# 06 — Extract `create_session` controller; bfcache + IDB owned by session

Type: AFK
Triage: ready-for-agent

## Parent

`plans/improvements/PRD.md`

## What to build

`attach_session_persistence` currently exposes a 9-key config that includes a quartet of getter/setter callbacks (`get_rate`, `set_rate`, `get_manual_offset_ms`, `set_manual_offset_ms`) plus `on_hint_invalidate`. It exists because the route is the only owner of the relevant state and the persistence module needs to read and write it on `pagehide` / `pageshow`. Once `create_playback` is in place (issue 04), playback itself is the owner — its public methods (`seek`, `cycle_rate`) and its reactive getters (`current_time`, `rate`) are exactly the surface a session controller needs. The callback quartet collapses into "the playback handle."

Introduce `create_session({ store, document_id, playback })` in `$lib/session/index.ts`. It:

- On mount, reads the persisted `{ position, rate }` for `document_id` from the store and replays them via `playback.seek(position)` and (if needed) `playback.cycle_rate()` calls until `playback.rate` matches the persisted value (or use a `playback.set_rate(value)` method if added).
- On `pagehide`, writes `{ position: playback.current_time, rate: playback.rate }`.
- On `pageshow` with `event.persisted === true`, re-reads `audio.currentTime` via `playback.current_time` (no replay needed — bfcache restored it).
- Surfaces a `storage_degraded` reactive read driven by the persistence store's `on_degraded` callback.
- Has no `beforeunload` handler.

Public surface:

```ts
create_session({ store, document_id, playback }): {
  readonly storage_degraded: boolean;
  teardown(): void;
}
```

After issue 02 lands, `manual_offset_ms` is already out of the persistence schema; this issue does not re-add it. The route's `storage_degraded` `$state` and the persistence-degraded toast survive but the value is read from `session.storage_degraded`.

## Acceptance criteria

- [x] `src/lib/session/index.ts` is created and exports `create_session`. (Implemented as `index.svelte.ts` to expose a reactive `storage_degraded` getter via runes.)
- [x] `attach_session_persistence` is deleted (or renamed and re-shaped — net change: gone).
- [x] `create_session`'s config has at most 3 keys: `store`, `document_id`, `playback`.
- [x] `+page.svelte` has at most one `$effect` block creating the session controller.
- [x] The route's `session` and `storage_degraded` `$state` variables are replaced by reads from the session controller's getter.
- [x] No `beforeunload` listener is added or remains.
- [ ] Unit tests cover: replay on mount restores playback position and rate; `pagehide` writes the current position+rate; `pageshow` with `persisted=true` skips the replay; `on_degraded` flips `storage_degraded`.
- [x] `npx vitest run` is green.
- [ ] Playwright `persistence.spec.ts` still passes — bfcache resume and degraded-toast behavior are unchanged from the user's perspective.

## Blocked by

- `04-extract-create-playback-controller` — session is coupled to the playback handle.
