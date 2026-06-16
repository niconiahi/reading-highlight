# 07 — Media Session API integration

Type: AFK
Triage: ready-for-agent

## Parent

`plans/production_alignment/PRD.md`

## What to build

Make `/production` controllable from the lock screen, headphone media keys, and car head units via the Media Session API.

A new `$lib/media_session` module owns the integration. It accepts the audio element and the route's `{ title, artist, artwork, get_position, get_duration, get_rate, on_play, on_pause, on_seek, on_prev_sentence, on_next_sentence }` and:

- Sets `navigator.mediaSession.metadata = new MediaMetadata(...)`.
- Registers action handlers: `play`, `pause`, `seekbackward` (-10 s), `seekforward` (+10 s), `previoustrack` (previous sentence), `nexttrack` (next sentence).
- Calls `navigator.mediaSession.setPositionState({ duration, playbackRate, position })` on every rAF tick.
- Tears down all handlers on route destroy.

Sentence-skip uses the existing sentence ranges from the loaded passage to find the next/previous sentence's first word index and seeks the audio to its start time.

## Acceptance criteria

- [ ] `$lib/media_session` exports an `attach(audio_el, config)` function returning a teardown closure.
- [ ] On mount, `/production` calls `attach` and sets metadata, action handlers, and a `setPositionState` loop.
- [ ] On destroy, all media-session state is torn down (metadata cleared, handlers unregistered).
- [ ] Playwright: trigger `navigator.mediaSession` actions via test hooks; assert `play`, `pause`, `seekbackward`, `seekforward`, `previoustrack`, `nexttrack` produce the documented behavior.
- [ ] Telemetry event `media_session.action` is emitted with `{ action: string }` for each handled action; recording-sink test asserts.
- [ ] No errors are logged when running in a browser without Media Session support (feature-detect `'mediaSession' in navigator`).

## Blocked by

- 01 — bootstrap-route-extract-svg-overlay
- 02 — telemetry-sink-seam
