# 04 — Extract `create_playback` controller; route owns no audio state

Type: AFK
Triage: ready-for-agent

## Parent

`plans/improvements/PRD.md`

## What to build

The `<audio>` element is currently `bind:this`'d in `+page.svelte` and seven separate `$effect` blocks reach into it (audio clock, media session, latency, session persistence, playback-rate setter, inline `<audio>` event handlers, plus various seek call sites). Four code paths set `audio.currentTime` directly: `seek_audio_to_word`, `seek_to_sentence`, `skip`, and `scrub`. The route holds 13 `$state` variables that are really facets of one playback domain (`playing`, `current_time`, `duration`, `rate`, `index`, `active_sentence_index`, `last_index`, `last_time`, `hint_valid`, `latency_offset_seconds`, plus three transient handles for the underlying controllers).

Introduce `create_playback(audio_el, { timings, sentences, on_word_change })` in `$lib/playback/index.svelte.ts` as the single owner of the audio element and everything reactive about it. Internally it composes the existing primitives (`attach_audio_clock`, `find_word_index_at_time` with its hint, `attach_media_session`, `attach_latency_measurement`, `attach_keybindings`) plus rate management and the one-time `preservesPitch` assignment. All four seek paths funnel through a single private function that updates `currentTime` and invalidates the search hint.

Public surface:

```ts
create_playback(audio_el, {
  timings,
  sentences,
  on_word_change,
}): {
  // commands
  toggle_play(): void;
  seek(time_seconds: number): void;
  seek_to_word(word_index: number): void;
  seek_to_sentence(sentence_index: number): void;
  skip(delta_seconds: number): void;
  cycle_rate(): void;

  // reactive reads — Svelte 5 getters backed by internal $state
  readonly playing: boolean;
  readonly current_time: number;
  readonly duration: number;
  readonly rate: number;
  readonly word_index: number;
  readonly active_sentence_index: number;

  teardown(): void;
}
```

The route reduces to: bind `audio_el`, instantiate `create_playback` once inside a single `$effect`, store the returned handle in one `$state`, render markup that calls `playback.toggle_play()`, `playback.skip(-10)`, etc. and reads `playback.current_time`, `playback.rate`, etc.

## Acceptance criteria

- [x] `src/lib/playback/index.svelte.ts` is created and exports `create_playback`.
- [x] All four pre-existing seek code paths funnel through one private `_seek(time)` in the controller; the route has no `audio_el.currentTime = ...` assignment outside that funnel.
- [x] `+page.svelte` has at most one `$effect` block that touches `audio_el` (the one that creates the playback controller). Inline `<audio>` `onplay`/`onpause`/`bind:duration` go away — those come from playback getters.
- [x] The route's `playing`, `current_time`, `duration`, `rate`, `index`, `active_sentence_index`, `last_index`, `last_time`, `hint_valid`, `latency_offset_seconds`, `media_session_controller`, `latency_controller` `$state` variables are deleted; reads come from `playback.*` getters.
- [x] `attach_audio_clock`, `attach_media_session`, `attach_latency_measurement`, `attach_keybindings`, and `find_word_index_at_time` are no longer imported by `+page.svelte`.
- [ ] Unit tests cover the public surface: `toggle_play`, every `seek*` variant, `skip`, `cycle_rate`, and the getters. Test through the public interface only — do not assert on internal state.
- [x] `npx vitest run` is green.
- [ ] Playwright `media_session.spec.ts` and `latency.spec.ts` still pass — `__media_session__` debug hook still installs against the playback controller's media session sub-controller.
- [ ] Manual smoke at `/`: play, pause, skip ±10s, scrub, click-to-seek, rate cycle, lock-screen media controls all behave identically to before.

## Blocked by

- `02-delete-latency-calibration` — so the playback controller is not built with a calibration sub-surface that immediately gets ripped out.
- `03-telemetry-singleton-logger` — so the playback controller is not built with a `sink` constructor parameter that immediately gets ripped out.
