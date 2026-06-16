# 08 — Measured audio latency + tap-to-calibrate

Type: AFK
Triage: ready-for-agent

## Parent

`plans/production_alignment/PRD.md`

## What to build

Stop guessing audio output latency on `/production`. A new `$lib/latency` module builds a Web Audio graph off the `<audio>` element via `createMediaElementSource`, reads `AudioContext.outputLatency` and `baseLatency`, and exposes a reactive total in seconds. The route subtracts this from `currentTime` when looking up the highlighted word so the highlight tracks what the user hears, not what the audio engine queued.

When the audio path changes (Bluetooth swap, USB DAC plug-in) `outputLatency` jumps. Poll it on a low-frequency interval (e.g. every 1 s) and on `audio.onplay`. When it changes by more than a threshold, update the reactive value live.

Add a settings affordance: a "Calibrate" button that plays a short beep and asks the user to tap when they hear it. The route records the delta between scheduled-play time and tap time as `manual_offset_ms`, persists it via slice 05's IndexedDB store, and adds it to the measured total. Persisted per `document_id` for now (a per-device key is a future refinement).

Emit `latency.measured` with `{ output_latency_ms, base_latency_ms, manual_offset_ms }` on every change.

## Acceptance criteria

- [ ] `$lib/latency` exports `measure_audio_latency(audio_el)` returning a reactive value (Svelte `$state` or a getter).
- [ ] `/production` subtracts the measured total from `currentTime` before passing to the hinted search.
- [ ] Polling detects `outputLatency` changes and updates the reactive value within 1 s.
- [ ] Calibration affordance: button → beep → tap → persisted `manual_offset_ms`.
- [ ] Calibration value round-trips through `$lib/persistence` and is applied on next page load.
- [ ] Telemetry event `latency.measured` is emitted on changes; recording-sink test asserts an event fires when the calibration completes.
- [ ] Unit test for the offset-sum math (measured + manual) covering positive, negative, and zero cases.

## Blocked by

- 01 — bootstrap-route-extract-svg-overlay
- 05 — persistence-bfcache
