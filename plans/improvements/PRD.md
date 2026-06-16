# PRD: `/` route — simplify and deepen modules

Status: ready-for-agent
Source: post-mortem on `plans/production_alignment/` after the route was wired end-to-end.
Reference target: simplicity. Speechify's actual reader chrome is play/pause + skip + rate. Anything we built that doesn't show up in the real product is a candidate for deletion.

---

## Problem Statement

After landing `plans/production_alignment/`, the `/` route ended up as a switchboard wiring 11 controllers together. Concretely:

- `src/routes/+page.svelte` is ~600 lines, with 23 `$state` variables and 13 `$effect` blocks.
- The route holds a reference to the `<audio>` element and seven separate effects reach into it. Four different code paths set `currentTime` to seek.
- Every module takes a `sink` parameter and threads it through call-by-call — but the sink is set globally on mount and read back via a context getter. The DI seam never gets a non-default implementation in production code, only in tests.
- Pure DOM helpers (`get_passage_text_node`, `make_range`, `get_caret_offset`, `get_active_word_rect`) live in the route file instead of with the renderer that consumes them.
- The route re-derives `data.text`, `data.ranges`, etc. through `$derived` even though `data` is loaded once and never changes.
- Several PRD bullets were built but the resulting code paths are effectively dead. The Highlight API render path is a Chrome-only branch whose SVG fallback already works on Chrome. Calibration is exposed as a UI button when real readers do not expose anything of the kind. The TTS Web Speech fallback existed for a streaming TTS outage on a route that ships a bundled MP3 (already deleted in a prior cleanup commit).

The shape is "one PRD bullet → one module," which is enumeration, not composition. The route absorbs all the coupling cost.

## Solution

Trim PRD bullets that don't survive a "would Speechify ship this?" check, kill the fake DI seam, and recompose the remaining behavior into three real controllers — playback, view, session — instead of eleven shallow ones.

Concretely:

1. Delete the Highlight API render path; SVG-only renderer.
2. Delete the latency calibration UI and module (auto `outputLatency` stays — no user input required).
3. Replace the telemetry sink DI with a singleton `logger.event(name, payload)`.
4. Extract `create_playback` — owns the `<audio>` element, the word-index search, media session, latency, keybindings, rate. One private `_seek` funnel for all four seek paths.
5. Extract `create_view` — owns the passage DOM helpers, SVG renderer, scroll controller. Coupled to playback via a minimal `{ word_index, active_sentence_index }` read interface.
6. Extract `create_session` — owns bfcache + IDB persistence. Reads/writes playback through its public methods.
7. Final route cleanup: drop `data` re-derivation, drop any `$state` that survived the refactor but is now dead.

A separate already-completed change removed the TTS Web Speech fallback (not filed here — done before this PRD existed).

Target shape after the refactor:

- `+page.svelte` ~250 lines (down from ~600), ~10 `$state` vars (down from 23), ~5 `$effect` blocks (down from 13).
- Three controllers in `$lib/`. No module exports a config object with more than 6 keys.
- `audio_el` is touched by exactly one consumer.
- One seek funnel, not four.

## User Stories

Same user stories as `plans/production_alignment/PRD.md` continue to apply for the surviving behavior:

- 1, 2, 3, 4 — Media Session integration (lock screen, headphones, car) — survives, owned by `create_playback`.
- 5, 6 — Latency tracking via `outputLatency` — survives, owned by `create_playback`.
- 7 — Manual calibration "tap when you hear the beep" — **dropped**. Real readers don't expose this.
- 8 — Tokenizer worker for large documents — survives unchanged.
- 9, 10 — User-scroll yield, snap-back affordance — survives, owned by `create_view`.
- 11 — bfcache resume — survives, owned by `create_session`.
- 12 — Web Speech TTS fallback — already dropped. The route ships a bundled MP3; there was no provider to outage. Fallback was ~40% functional in practice (broken on Safari, no smooth progress bar, no media session integration).
- 13, 14 — IndexedDB persistence + degraded toast — survives, owned by `create_session`.
- 15, 16 — Structured telemetry events — survives, but via singleton `logger.event` not DI.
- 17, 18 — Highlight API capability detection — **dropped**. SVG-only path works everywhere including Chrome.
- 19 — Scrub seek — survives, funneled through `playback.seek`.
- 20 — Persist rate + voice — rate survives in `create_session`; voice never applied (single bundled MP3).

## Out of Scope

- Visual / chrome redesign to more closely mirror Speechify's compact floating-pill UI. Cosmetic; separate concern from this composition refactor.
- Anything touching `/speechify/range-rects`. The baseline stays as a reference.
- New behaviors not already in `plans/production_alignment/`. This PRD is subtractive and structural, not additive.
