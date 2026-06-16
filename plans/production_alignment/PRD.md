# PRD: `/production` route — production-aligned reader

Status: ready-for-agent
Source: `docs/MISSING.md` §B + §C (web-app gaps). §A (extension) and §B.2/§B.3/§B.8 are out of scope.
Reference baseline: `src/routes/speechify/range-rects/+page.svelte`.

---

## Problem Statement

The existing `/speechify/range-rects` route is a focused prototype: it proves the highlight geometry and click-to-seek pipeline, and that's it. A user who picks it up to "feel like Speechify" hits a wall the moment they leave the visible viewport:

- They lock their phone — playback metadata is missing from the lock screen, headphone buttons do nothing, the car head unit shows "Unknown."
- They plug in Bluetooth headphones — the highlight drifts ~200 ms behind the voice because the route subtracts a hardcoded latency that doesn't match the actual audio path.
- They scroll up to re-read a sentence — the next-word auto-scroll yanks them back down. They give up and turn auto-scroll off for the rest of the document.
- They hit the back button after tapping a link — the page reloads from scratch, audio restarts, position is lost.
- They open a 50k-word document — tokenization runs on the main thread, the page freezes for several seconds, INP tanks.
- The TTS endpoint has an outage — they get a spinner instead of degraded-but-working audio from the browser's built-in voices.
- Stakeholders ask "does the highlight land on the right word for the long tail?" and there is no answer because nothing measures it.

The route reads like a reader-shaped tech demo, not a product.

## Solution

A new top-level route `/production` that mirrors the visible behavior of `/speechify/range-rects` (same passage, same highlight visuals, same click-to-seek) and closes the production-readiness gaps from `docs/MISSING.md` §B and §C that are reachable in a web context.

Concretely the `/production` route adds, on top of the baseline:

1. Lock-screen / headphone / car integration via Media Session API.
2. Tokenization moved to a Web Worker so the main thread stays responsive on large documents.
3. Latency measured from `AudioContext.outputLatency` (with a calibration affordance) rather than hardcoded.
4. bfcache-compatible lifecycle — no `beforeunload`, persist on `pagehide`, resync on `pageshow`.
5. Auto-scroll that yields to the user when the user is actively scrolling.
6. A structured telemetry sink (no-op default) measuring word-sync drift, highlight-paint latency, and click-to-seek round-trip.
7. A Web Speech API degraded fallback when the primary TTS source is unavailable.
8. Hinted forward-search on the rAF hot path; binary search as the scrub-detection fallback.
9. Highlight API capability detection with graceful fallback to the existing SVG-overlay path.
10. IndexedDB-backed position and settings persistence with explicit failure handling.

The route is a self-contained reference for what a production reader looks like, side-by-side with the simpler prototypes, so the gap is legible.

## User Stories

1. As a Speechify user with my phone in my pocket, I want the lock screen to show the document title and artwork, so that I can confirm what's playing without unlocking.
2. As a Speechify user with wired headphones, I want the inline play/pause button to control playback, so that I can pause without taking the phone out.
3. As a Speechify user with Bluetooth headphones, I want the headset's skip-forward button to advance one sentence, so that I can skim without looking.
4. As a driver listening through Bluetooth, I want the car head unit to show the document title and current position, so that I know what I'm hearing.
5. As a Speechify user on AirPods, I want the highlight to stay on the word I hear, so that I can follow along despite the headset adding ~200 ms of latency.
6. As a Speechify user on a USB DAC, I want the highlight to stay tight without my having to reconfigure anything, so that switching audio devices "just works."
7. As a Speechify user who can't get the highlight to feel right, I want a calibration affordance ("tap when you hear the beep"), so that I can dial in my own offset for cases the browser can't see.
8. As a Speechify user reading a 400-page novel, I want the page to remain responsive while the document is being tokenized, so that I can scroll and tap immediately rather than staring at a frozen screen.
9. As a Speechify user, I want to scroll up to re-read a sentence I missed without the reader yanking me back, so that I stay in control of where I'm looking.
10. As a Speechify user who scrolled away from the current word, I want a "snap back to highlight" affordance, so that I can opt back into auto-scroll on demand.
11. As a Speechify user tapping a link to a referenced page, I want hitting back to return me to the exact word I was on with audio still ready to resume, so that following references is cheap.
12. As a Speechify user whose TTS provider is having an outage, I want the reader to fall back to the browser's built-in voice with the degraded state surfaced honestly, so that I can still finish my chapter on the train.
13. As a Speechify user, I want my position in the document to persist across reloads and crashes, so that I never have to scrub back to find where I left off.
14. As a Speechify user with a corrupt or full storage backend, I want a clear toast and in-memory continuation rather than a silent failure, so that I know the persistence is degraded.
15. As a Speechify product owner, I want word-sync drift, paint latency, and click-to-seek round-trip emitted as structured events, so that I can answer "does the highlight land on the right word" with data.
16. As a Speechify engineer in development, I want a no-op telemetry sink by default so that running locally doesn't require a backend, but I want the seam to be production-replaceable with one swap.
17. As a Speechify user on Firefox where the Highlight API isn't shipped, I want the route to fall back to the SVG-overlay rendering automatically, so that the page doesn't appear broken.
18. As a Speechify user on Chrome 105+, I want the Highlight API path to be used when available, so that the highlight composites with native browser selection cleanly.
19. As a Speechify user scrubbing the progress bar, I want the highlight to jump to the seeked position immediately, so that scrubbing feels responsive.
20. As a Speechify user, I want playback rate and voice choice to persist across sessions, so that I don't reconfigure every time.

## Implementation Decisions

### Routing and layout
- New route at `/production`, mirroring the structure of `/speechify/range-rects`: a `+page.ts` that uses the existing `$lib/load_passage` seam, a `+page.svelte` that owns the reader shell.
- The reader visual surface (passage + SVG overlay + player chrome) is intentionally identical to the baseline so the gap is in behavior, not visuals.

### Pure-logic modules — new `$lib/playback/`
Extract pure functions out of the route to make them unit-testable and to deduplicate between the baseline and `/production`:
- `find_word_index_at_time(timings, t, last_index)` — hinted forward search up to N=3 steps; binary fallback when `|t − last_t| > SCRUB_THRESHOLD`. (C.1)
- `find_sentence_for_word` — already exists in `tokenizer`, reused as-is.
- `should_autoscroll({ user_scroll_idle_since, programmatic_window })` — pure predicate driving the autoscroll effect (B.7).

### Tokenizer worker — new `$lib/tokenizer.worker.ts`
- Same `get_sentence_ranges` / range derivation, hosted in a module worker.
- The main thread posts text + word ranges; the worker posts back `{ sentences, word_ranges }` via `postMessage` with `transfer: [buffer]` where applicable.
- `load_passage` gains a `tokenize` strategy parameter; `/production` uses the worker strategy, the baseline keeps the inline one. (B.4)

### Latency — new `$lib/latency.ts`
- `measure_audio_latency(audio_el)`: reads `AudioContext.outputLatency` and `baseLatency` from a graph built off the `<audio>` via `createMediaElementSource`. Returns total measured latency in seconds.
- Exposes a Svelte-side store/`$state` that reacts to `outputLatency` changes (device hot-swap).
- Persists a user-calibrated `manual_offset_ms` on top, summed with measured latency.
- Calibration UX: a settings affordance "tap when you hear the beep" that records the delta. (B.5)

### bfcache compatibility
- No `beforeunload` listener. Existing route doesn't add one; `/production` formally bans it.
- `pagehide` handler persists `{ position, rate, voice }`.
- `pageshow` handler with `event.persisted === true` re-reads `audio.currentTime` and re-syncs the rAF tick. (B.6)

### User-vs-programmatic scroll
- Listen for `wheel`, `touchstart`, `keydown` (arrows, PgUp/PgDn, space) on the scroll root.
- Set `user_scroll_idle_since = Date.now()` on each event.
- Gate the programmatic `scrollBy` in the existing autoscroll effect on `Date.now() − user_scroll_idle_since > USER_IDLE_MS` (default 4000).
- "Snap back to highlight" button visible whenever the active word's rect is outside the visible scroll root. (B.7)

### Media Session API — new `$lib/media_session.ts`
- `metadata = new MediaMetadata({ title, artist, artwork })`.
- Action handlers: `play`, `pause`, `seekbackward` (-10 s), `seekforward` (+10 s), `previoustrack` (previous sentence), `nexttrack` (next sentence).
- `setPositionState({ duration, playbackRate, position })` updated on every rAF tick (cheap call).
- Lives off the `audio_el` reference; teardown on `onDestroy`. (B.1)

### Persistence — new `$lib/persistence/`
- IndexedDB-backed store keyed by `document_id`, holding `{ position, rate, voice, manual_offset_ms, updated_at }`.
- Promise-based API; tests use an in-memory fake that implements the same interface.
- Quota-exceeded and access-denied errors surface as a toast and degrade to in-memory state — never throw upward. (C.3, partially B.8 shape)
- No `localStorage` use in `/production`.

### Telemetry — new `$lib/telemetry/`
- `Sink` interface: `emit(event_name, payload)`. Default implementation is a no-op.
- Events emitted by `/production`:
  - `playback.drift_sample` — every 5 s during play, `{ expected_word, actual_word, voice, rate }` (B.9).
  - `highlight.paint_latency` — from `audio.currentTime` advance to DOM write, via `performance.mark`/`measure`.
  - `click_to_seek.round_trip` — click → audio `seeked` event, in ms.
  - `media.error` — `audio.error` code, classified.
  - `tts.fallback_used` — when the Web Speech fallback engaged.
- Sink is constructor-injected (or `setContext`-provided) so tests can substitute a recording sink. (B.9)

### TTS fallback — new `$lib/tts/`
- Primary path: the existing `<audio>` element with the bundled MP3.
- Probe failure (404, network error, `audio.error`): swap to a `SpeechSynthesis`-driven fallback.
- Fallback driver listens to `SpeechSynthesisUtterance.onboundary` to advance the highlight word-by-word.
- UX shows "Using your device's voice while we reconnect"; auto-probes the primary every N seconds, swaps back when healthy. (B.10)

### Highlight rendering — capability detection
- On mount, detect `'highlights' in CSS`.
- If true, render via `::highlight(active)`, `::highlight(hover)`, `::highlight(word)` using `CSS.highlights.set(...)` with `Range` objects. (C.2)
- If false, fall back to the SVG-overlay pipeline already in `/speechify/range-rects` (reuse `build_outline_path`).
- Geometry helpers (`get_local_line_rects`, `build_rounded_rect_path`) move into `$lib/highlight/svg_overlay.ts` for shared use.

### Hot-path search
- Replace `$derived.by` binary search at line 38 of the baseline with `find_word_index_at_time(timings, current_time, last_index)`.
- `last_index` lives in a `$state`; resets to 0 on `seeked`. (C.1)

## Testing Decisions

### What makes a good test here
- Test through the seam, not the implementation. A test that mocks `requestAnimationFrame` to check that a private method got called is brittle; a test that drives `audio.currentTime` forward and asserts that the highlight word index advanced is durable.
- For DOM geometry and browser APIs (Media Session, `pageshow`, scroll yield), prefer Playwright over jsdom — jsdom doesn't lay out text and will lie about rect positions.
- For pure logic (tokenizer worker payloads, hinted search, autoscroll predicate, telemetry events), prefer vitest unit tests in the style of the existing `tokenizer.test.ts`.

### Modules under test
- `$lib/playback/find_word_index_at_time` — unit. Inputs: timings array, time, last_index. Assert: returns expected index; falls back to binary on large delta. Prior art: `tokenizer.test.ts`.
- `$lib/playback/should_autoscroll` — unit. Pure predicate over `{ now, user_scroll_idle_since, threshold }`. Easy table-driven test.
- `$lib/persistence/` — unit against the in-memory fake; one integration test against real IDB in Playwright.
- `$lib/telemetry/` — unit. Provide a recording sink, run a fake playback loop, assert event sequence.
- `$lib/tokenizer.worker.ts` — unit via direct function import (the worker module exports the worker handler as a pure function); plus one Playwright smoke that loads the route and asserts the worker actually ran (no main-thread tokenization).
- `$lib/media_session.ts` — Playwright. Drive `navigator.mediaSession.metadata` reads and trigger registered actions via test hooks.
- `/production` end-to-end — Playwright:
  - bfcache: load route, navigate away, back; assert audio position preserved.
  - user-scroll yield: scroll up, advance audio; assert no programmatic scroll for `USER_IDLE_MS`.
  - Web Speech fallback: stub the audio source to fail; assert fallback UX appears and highlight still advances.
  - Highlight API path: assert capability detection branches correctly.

### Out-of-scope test work
- Visual regression on the highlight pills — covered implicitly by mirroring the baseline; not in this PRD.
- Cross-browser matrix runs — Playwright is configured for Chromium only in this PRD.

## Out of Scope

- **§A — Chrome extension** (readability extraction, MV3 service worker, offscreen documents, content scripts, hostile-DOM CSS isolation). Different surface, different runtime, separate PRD.
- **§B.2 — PDF extraction.** No PDF input in this prototype.
- **§B.3 — Streaming TTS / MSE.** Requires a streaming TTS backend; the prototype ships with a bundled MP3.
- **§B.8 — Cross-device sync transport.** The persistence shape (`(user_id, document_id) → { position, ... }`) is honored, but no WebSocket / REST sync, no conflict resolution. The seam exists for a follow-up.
- **§C.4 — Documentation retrieval restructure.** That's a docs change, not a route.
- Any change to `/speechify/range-rects` itself. `/production` is additive; the baseline stays as a reference. Shared helpers extracted to `$lib/` are reused by both, but the baseline's behavior does not change.

## Further Notes

- The baseline's `update_highlight_paths` orchestrator and its SVG-overlay geometry are the fallback path under capability detection. The PRD does not delete them; it extracts them to `$lib/highlight/svg_overlay.ts` so both routes can reach them. This keeps the visual identity intact when Highlight API is unavailable.
- Telemetry payloads are intentionally small and primitive-only. No PII, no full passages. The recording-sink test substitutes a plain array.
- The Web Speech fallback path is deliberately worse — no advance highlight, voice is OS-provided. The PRD specifies surfacing the degraded state honestly rather than papering over it.
- Auto-recovery from fallback to primary uses an exponential backoff probe (10 s, 30 s, 60 s, capped at 5 min) to avoid hammering a downed service.
- `last_index` for hinted search resets on the `seeked` event, not on every `seeking` — this matters during scrubbing, where `seeking` fires many times per second.
