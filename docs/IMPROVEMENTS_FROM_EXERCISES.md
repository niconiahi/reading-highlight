# Improvements to the home route from `/exercises/*`

Map of every Speechify interview exercise (01–10) to the concrete integration
point in this repo's `/` route. Ranked by ROI for the route as it stands today.

---

## High value (clear win, low effort)

### 02 — SSML parser
SSML → AST → compiled JSON. Replaces the hand-prepared
`static/abou-ben-adhem.json` with a build-time pipeline. Source of truth
becomes `poem.ssml`. The parser produces:
- `text`              — concatenated decoded text
- `sentences[]`       — `<s>` boundaries with `start` / `end` / `first_word_index`
- `ranges[]`          — word offsets, tokenized from `text`
- `timings[]`         — from TTS speech-marks alongside the MP3

`+page.ts` and `+page.svelte` don't change at all — they still load JSON and
an MP3. SSML just becomes the authoring format that *generates* both.

### 06 — Debounce / throttle
Two clear targets in `src/routes/+page.svelte`:

| Site | Current | Fix |
|---|---|---|
| `onmousemove` on `.passage` (~line 198) | runs `caretPositionFromPoint` on every pixel | throttle to ~16ms (one frame) |
| `oninput` on the scrub `<input type="range">` | calls `playback.seek` on every event | debounce ~50ms so drag doesn't spam the audio element |

Direct CPU win, five-minute change.

### 07 — Binary search
`find_sentence_index_by_offset` in `$lib/tokenizer` and the
`current_time → word_index` lookup inside `playback` are almost certainly
linear scans. Replace with binary search over `timings[]` and `sentences[]`.

For a 200-word poem it doesn't matter; for article-length passages it's the
difference between smooth playback and dropped frames.

---

## Medium value (real but situational)

### 03 — First-line height
Scroll-follow ("keep the active sentence in view") is the next logical UX.
To scroll smoothly you want the **top of the first line of the active
sentence** in view, not the bounding-box top of a multi-line sentence.
`first_line_height` gives you that exact offset. Also useful for positioning
a floating "play from here" affordance at the first line.

### 05 — MutationObserver
You already have a `ResizeObserver` for layout. A `MutationObserver` on
`.passage` would let you handle text changes — useful when adding:
- user-editable passage
- font swap mid-session
- inline annotations
- dynamic insertion of footnote markers

Without it, those mutations leave highlight rects stale until the next resize.

### 01 — LRU + TTL cache
Two integration points:
1. Cache `get_local_line_rects(tn, start, end, origin)` keyed by
   `(start, end, passage_rect)`. The function is called from three
   `$derived.by` blocks (hover, active, word) on every reactive update; same
   inputs recompute the same rects. TTL handles "layout changed → invalidate."
2. If the app supports multiple texts, cache decoded SSML → JSON results so
   switching back to a poem is instant.

---

## Lower value (only if the app grows)

### 09 — Trie autocomplete
"Type to jump to a word/phrase in the passage." Useful for audiobook-length
texts; overkill for a poem. Trie built once from `data.ranges`, prefix-match
in microseconds.

### 04 — Readable nodes
Out of scope for the current home route — the passage is already structured.
Only matters if the app grows a "paste any URL and read it" mode; then this
is the front door and the entire Chrome-extension story.

### 08 — Concurrent queue
Not for the home route per se. Useful in a **build script** that renders
multiple sentence-fragment MP3s via cloud TTS with bounded concurrency, or at
runtime if you preload the next chapter while the current one plays.

### 10 — Event delegation
You already do this in spirit — one click handler on `<blockquote>` resolves
to a sentence via `caretPositionFromPoint`. The exercise's pattern only
becomes load-bearing if you switch to per-sentence/per-word `<span>`
rendering (e.g., for screen-reader granularity). Currently a no-op.

---

## Suggested order of integration

1. **02** (SSML) — unblocks the authoring story.
2. **06** (debounce/throttle) — five-minute change, immediate perf.
3. **07** (binary search) — drop-in algorithmic fix in `tokenizer` / `playback`.
4. **03** (first-line-height) — when you add scroll-follow.
5. **01** (LRU+TTL) — when rect recomputation measures as a hot spot, or
   multi-text mode lands.
6. **05** (MutationObserver) — when text becomes mutable.

Skipped: **04**, **08**, **09**, **10** — solid exercises, but solutions to
problems the home route doesn't have yet.
