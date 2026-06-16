# 03 — Hinted forward-search on the rAF hot path

Type: AFK
Triage: ready-for-agent

## Parent

`plans/production_alignment/PRD.md`

## What to build

Replace the per-frame binary search for "current word index" on `/production` with a hint-based search that starts from the previous frame's index and walks forward 0–3 steps in the common case, falling back to binary search when a large time delta (configured constant, default 1 s) is detected — that is, on user scrubs or seeks.

This is the "hot path is a hint, binary is the fallback" optimization from PRD C.1. It does not change visible behavior; it changes per-frame work from ~14 comparisons to 0–2 in the common case.

Pure function lives in a new `$lib/playback/find_word_index_at_time` module so it can be unit-tested without DOM or audio. The hint state (`last_index`, `last_time`) is held in the route's `$state`. The route resets `last_index` to a forced binary-search on the `audio` element's `seeked` event (not `seeking`, which fires many times per scrub).

Emit a `playback.hot_path_used` telemetry event on every frame with one of `{ "hint" | "binary" }` so the recording fake can verify which path was taken during tests. Sampled, not every frame — payload should be a count emitted every N frames (constant, default 60) to keep volume reasonable.

## Acceptance criteria

- [ ] `$lib/playback/find_word_index_at_time` exists and is unit-tested for: (a) zero-delta returns same index, (b) small forward delta walks forward, (c) large delta triggers binary fallback, (d) backward delta triggers binary fallback.
- [ ] `/production` uses the hinted search on every rAF tick.
- [ ] On `audio.seeked`, the hint is invalidated and the next tick uses binary.
- [ ] Highlight visible behavior on `/production` is identical to the baseline at the same time offsets (manual smoke).
- [ ] Telemetry event `playback.hot_path_counts` is emitted with `{ hint: number, binary: number }` once per N frames; recording-sink test asserts hint count >> binary count during steady playback.

## Blocked by

- 01 — bootstrap-route-extract-svg-overlay
- 02 — telemetry-sink-seam
