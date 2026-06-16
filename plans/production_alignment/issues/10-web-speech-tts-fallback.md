# 10 — Web Speech API degraded TTS fallback with auto-recovery

Type: AFK
Triage: ready-for-agent

## Parent

`plans/production_alignment/PRD.md`

## What to build

When the primary `<audio>` source fails on `/production` — 404, network error, or any `audio.error` event — fall back to the browser's built-in `SpeechSynthesis` so the user can still finish their document. Recover automatically when the primary source is reachable again.

A new `$lib/tts` module owns the two drivers and the swap:

- **Primary driver**: the existing `<audio>` element. Detect failure via `audio.error` and `fetch`-probe failure.
- **Fallback driver**: a `SpeechSynthesisUtterance` for the current sentence, with `onboundary` events advancing the highlight word-by-word. The advance is approximate (no pre-baked timings) — match boundary `charIndex` to the current passage word ranges.
- **Recovery probe**: when in fallback, an exponential-backoff probe (10 s, 30 s, 60 s, capped at 5 min) `HEAD`s the primary source. On success, swap back to the primary driver at the current sentence boundary.

The route surfaces the degraded state honestly: a small banner "Using your device's voice while we reconnect." Banner clears when the primary recovers. Hover-sentence and active-sentence highlights still work; current-word highlight lags or skips on `boundary` granularity — the PRD accepts this as the degraded experience.

Emit `tts.fallback_used` when the swap happens with `{ reason: string }`, and `tts.primary_recovered` when the probe succeeds.

## Acceptance criteria

- [ ] `$lib/tts` exports a primary driver, a fallback driver, and a controller that swaps between them.
- [ ] Forcing the audio source to a 404 swaps to the fallback within a reasonable window (e.g. 2 s) and the route continues to play the passage via `SpeechSynthesis`.
- [ ] The degraded banner is visible while in fallback; hidden in primary.
- [ ] Recovery probe succeeds and the route swaps back to primary at the next sentence boundary.
- [ ] Current-word highlight advances on `SpeechSynthesisUtterance.onboundary` events during fallback.
- [ ] Telemetry events `tts.fallback_used` and `tts.primary_recovered` fire as specified; recording-sink test asserts the sequence during a scripted failure-then-recovery scenario.
- [ ] Backoff sequence is unit-tested (pure function from attempt count → delay).

## Blocked by

- 01 — bootstrap-route-extract-svg-overlay
- 02 — telemetry-sink-seam
