# Building Speechify's reading surface, from browser primitives

This is interview prep for the Speechify front-end role, narrowed to
exactly what the home page (`/`) ships. Speechify was founded by
someone with dyslexia and ADHD, and that origin is not decoration: the
product exists because reading is an accessibility problem, and the
reader UI is the place that problem actually gets solved. Every
technique in this document is judged on two axes — does it work, and
does it work for someone who needs the app to work — because in this
codebase those two axes are the same axis.

The home page is one fully-functional reader: an `<audio>` element, a
single `<blockquote>` of prose, and an SVG overlay that paints three
named highlights (hover sentence, active sentence, current word) on
top. Read this doc for the *why*; open `src/routes/+page.svelte` and
`src/lib/` for the dense code.

---

## 0. The contract

Everything downstream of the TTS pipeline reduces to four pieces of
data, served as a static JSON from `/abou-ben-adhem.json`:

- a **text** string,
- a list of **word ranges** — `[char_start, char_end]` per word in that string,
- a list of **word timings** — `{ start }` in seconds per word,
- a list of **sentence spans** stitched on top — `{ start, end, first_word_index, last_word_index }`.

That's it. The whole reader is "given the current audio time, which
word index is active, where does it sit in the text, and where does
it sit on the screen."

Internalizing this shape makes the rest of the doc trivial: everything
below is one of those mappings 
- *time → word index*, *word index → character range*, *character range → geometry*
- *click → character range → sentence index → word index → time*

Tokenization itself runs offline at build time (see `/whisper`), so
the runtime never touches `Intl.Segmenter`. The TS surface that
matters is two tiny linear scans in `src/lib/tokenizer.ts`:
`find_sentence_index_by_offset` (used by click/hover hit-testing) and
`find_sentence_index_by_word` (used to derive the active sentence
from the current word).

---

## 1. Audio playback

### `<audio>` is enough

The home page reaches for `HTMLAudioElement` and nothing else. It
hands you progressive download, seeking, format negotiation, and a
`currentTime` that's accurate to well under a frame, all for free.
You only graduate to Web Audio when you need something it can't give
you: visualizers, gapless concat across utterances, sample-accurate
scheduling, or compression.

The properties that matter in this reader cluster around one verb:
"touch the timeline*. `currentTime` is the spine of everything — you
read it every frame to drive the highlight, and you write it to seek.
`playbackRate` is the knob the user actually grabs; the home page
cycles through `[0.75, 1, 1.25, 1.5, 2]`. The browser resamples
naively when you change it, though, so voices go chipmunky unless you
pair it with `preservesPitch = true` at construction. That pairing
isn't cosmetic: a dyslexic user reading at 1.5× hears a voice they
can't parse without it, which defeats the product. The remaining two
worth touching are `duration` and `paused`, both pure UI state.

### Events we actually listen for

`create_playback` wires the full event surface:

- `play` / `pause` — drive the reactive `playing` flag.
- `loadedmetadata` — `duration` isn't known until this fires.
- `ended` — telemetry only; UI keeps the highlight where it landed.
- `error` — inspect `audio.error.code` (the `MEDIA_ERR_*` family) and
  log. A 403 mid-playback shouldn't reset the user's place.
- `waiting` / `canplaythrough` — telemetry signals for buffering
  trouble; useful when interpreting reports of "the highlight froze."

The event you'll notice missing is **`timeupdate`**. The spec lets
the browser fire it whenever; in practice you get 4–15 firings per
second. That's slower than most short words, so the highlight
visibly trails the voice. We use `requestAnimationFrame` instead
(§2).

### Accessibility implications

The audio *is* the accessibility feature. The page exposes a single
`aria-live="polite"` region with the current word — that's a
deliberate, debated choice. The defensible reading is: the live
region is a fallback for screen-reader users who have muted the TTS
voice and want positional awareness from their own AT. If that
double-speak is a problem in your environment, the live region is
the first thing to gate behind a setting. Live regions otherwise
belong on app-level events (playback paused, end of chapter), not
the per-word stream.

---

## 2. The time-sync loop

The home page runs one loop: an `<audio>` element, a
`requestAnimationFrame` tick that copies `audio.currentTime` into
reactive state, and a derived computation that turns that time into a
word index.

### Why `requestAnimationFrame`

It's tied to the display refresh, it pauses in background tabs (so a
hidden tab doesn't burn CPU advancing a highlight nobody can see),
and it aligns with the compositor — meaning your DOM writes land on
the same frame the browser is about to paint. `setInterval` does
none of these things.

### `findLastIndex` with the right semantics

The classic mistake: "active when `start ≤ t < end`." That makes the
highlight disappear during the silences between words — and there
are *always* silences. Punctuation pauses, breath pauses, sentence
boundaries. You want the previous word to stay highlighted across
the gap, which is exactly:

```ts
const i = timings.findLastIndex((w) => w.start <= current_time);
word_index = i < 0 ? 0 : i;
```

**Largest index `i` such that `words[i].start ≤ t`.** It never
touches `end`. As a bonus, short words can't be missed by a 16 ms
rAF tick landing in their middle, because the search resolves to
whichever word started most recently.

### Linear scan vs binary search

The home page does a linear `findLastIndex` over ~150 words. That's
~150 comparisons per frame — invisible. For a 10k-word document
it's 10k comparisons at 60 Hz, ~14 ms wasted per second, which
starts to bite. The fix is binary search (`O(log n)`, ~14
comparisons for 10k words) and the call-site comment marks the
upgrade path. The principle: optimise when the size demands it, not
before.

### Latency budget

The end-to-end "did the highlight land on the right word" budget
breaks down roughly as:

- Audio output latency (browser → speaker): 20–100 ms.
- rAF granularity at 60 Hz: ~16 ms.
- TTS-emitted word timings: < 10 ms error.
- Forced-aligned timings (Whisper / MFA): 30–500 ms error.

If the highlight feels late, subtract a small constant (60–100 ms)
from `t` before the search. Bias *early* — landing on the next word
a hair before the voice says it reads as "in sync"; landing late
reads as "broken.s "

### The active sentence falls out for free

`active_sentence_index` is derived from `word_index` via
`find_sentence_index_by_word`. No separate clock, no parallel
search; the sentence layer is purely a projection of the word layer.

---

## 3. Highlight rendering — `Range.getClientRects()` into an SVG overlay

This is the section the home page is built around. Three named
layers — hover sentence, active sentence, current word — painted as
rounded `<rect>` elements inside a single SVG that sits behind the
unmodified prose.

```ts
const range = document.createRange();
range.setStart(text_node, start);
range.setEnd(text_node, end);
for (const r of range.getClientRects()) { ... }
```

The killer method. Given any `Range` over text — even a sub-range
that isn't aligned to any element boundary — the browser hands you
one `DOMRect` per line-box. You take those rects, subtract the
offset of a positioned ancestor, and render them as
absolute-positioned shapes in a layer *behind* the text.

The home page renders into **SVG** rather than absolute-positioned
`<div>`s. The trade is small but real: one SVG node with many
`<rect>` children composites a hair more efficiently than N
positioned divs, and `rx`/`ry` give per-corner rounding without CSS
per element. The overlay is one `<svg aria-hidden="true">` with
three groups of `<rect>` — `.hover`, `.active`, `.word` — painted in
DOM order so word sits on top of sentence sits on top of hover.

### Why this technique

- **The prose stays as you wrote it.** `<blockquote class="passage"
  cite="…">The text…</blockquote>` survives untouched. No wrapping
  spans, no hundred nodes per paragraph. Reader-mode extractors,
  search crawlers, screen readers, and your future self all see the
  prose you authored.
- **Sub-range freedom.** You can highlight any character range,
  whether or not it aligns to an element. The technique doesn't
  care.
- **Full styling freedom.** Unlike the CSS Custom Highlight API
  (which restricts you to `color`, `background-color`,
  `text-decoration`, `text-shadow`, and the
  `-webkit-text-stroke-*` family — no `border-radius`, no padding),
  SVG `<rect>` gives you rounded corners, strokes, gradients,
  filters, anything paintable.

The two techniques you'd reach for instead:

- `box-decoration-break: clone` on inline spans — pure CSS, wraps
  per line for free, **but** requires wrapping the highlight target
  in an element, which destroys clean prose markup. Requies splitting
  text into as many `<span>` as the text is. So, that's a lot
- CSS Custom Highlight API — zero DOM nodes, the cleanest possible
  story, **but** flat rectangles only and Firefox support was
  flagged for a long time. Right answer when you want a search-hit
  style highlight on text that must stay pristine.

### Coordinates and the BLEED

`getClientRects()` returns viewport-relative rectangles. The home
page keeps the passage's bounding rect in `passage_rect` state
(see §3 *Re-measure on reflow*), exposes it as a `$derived`
`origin = { x: passage_rect.left, y: passage_rect.top }`, and
subtracts it from every rect so the SVG draws in local coordinates.
A small `PAD_X = 3` / `PAD_Y = 2` is added so the painted rect is
slightly larger than the glyph box (matches the visual intuition of
a highlight that *contains* the word). The wrapping SVG carries a
`BLEED = 10` margin via its `viewBox` so the rects at the edge of
the passage aren't clipped, and the SVG's CSS positions it with
`top: -10px; left: -10px; overflow: visible`.

### Re-measure on reflow

Costs you take on with `getClientRects`: you must re-measure on
resize, on font load, on any content change. The home page wires a
single `ResizeObserver` on the passage wrapper and stores the
result as state:

```ts
let passage_rect = $state({ left: 0, top: 0, width: 0, height: 0 });

const observer = new ResizeObserver(() => {
  if (!passage_el) return;
  const r = passage_el.getBoundingClientRect();
  passage_rect = { left: r.left, top: r.top, width: r.width, height: r.height };
});
observer.observe(passage_el);
```

Every consumer reads `passage_rect` as a real value:
`overlay_w`/`overlay_h` and `origin` are `$derived` from it, and
`rects_hover`/`rects_active`/`rects_word` are `$derived.by` that
call `get_local_line_rects(tn, …, origin)`. When the observer
writes new dimensions, those derivations re-run automatically —
no "tick" counter, no manual invalidation. The dependency graph
is the data flow.

`ResizeObserver` fires on internal layout shifts (font load,
content change, ancestor width change), not just viewport resize,
which is exactly what we need. You'd pair with a `resize`
listener only if you care about viewport shifts that don't affect
the observed element (rare).

### Accessibility

The overlay SVG is `aria-hidden="true"` with `pointer-events: none`.
Selection and AT both see the underlying prose, untouched. Clicks
land on the text node (§4); the SVG never intercepts them. The
visual depends on JS — if scripts fail, the prose stays readable
but the highlight vanishes. That's graceful degradation, not
failure, but it's worth naming in interviews.

### Why not `Range.surroundContents()`

It throws `InvalidStateError` if the range crosses any element
boundary. The moment your text contains a single inline `<strong>`,
`<a>`, or previous wrapper, you crash. Useful for "wrap a fresh
user selection once" and basically nothing else.

### Why not `innerHTML`

Re-parses HTML every tick, requires hand-rolled escaping of every
dynamic value, and any escaping miss is an XSS hole. The text-node
+ range approach is XSS-safe by construction.

---

## 4. Click-to-seek and hover

A reader where you can't click a sentence to start reading from it
is a worse reader. Speechify ships this; the home page ships it at
**sentence** granularity, which is the right default — clicking a
single word as a seek target is fiddly under the finger and almost
never what the user wanted anyway.

### Hit-testing text

`document.caretPositionFromPoint(x, y)` returns
`{ offsetNode, offset }` — the text node and character offset
under the cursor:

```ts
const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
```

The page then confirms the hit node *is* the passage's text node.
Otherwise the click hit decoration (the overlay, scrollbars,
padding), not prose. From the character offset,
`find_sentence_index_by_offset` returns the sentence;
`seek_to_word(sentences[i].first_word_index)` does the seek.

### Hover uses the same plumbing

`onmousemove` calls `sentence_at(e)` — the same hit-test as the
click handler — and assigns the result to `hover_sentence`. That
state feeds a `$derived` (`rects_hover`) which calls
`get_local_line_rects` to produce the SVG `<rect>` geometry for
the hovered sentence. So one function — `sentence_at` — turns a
pixel into a sentence index, and both click-to-seek and hover
call it.

### The `Selection` API is not wired here

The home page does not yet listen for `selectionchange` or expose a
"play selection" affordance. The plumbing is the same — take
`document.getSelection().getRangeAt(0)`, map its `startContainer`
+ `startOffset` to a character index, binary-search the word table
— and is a natural follow-up for the "play this paragraph"
interaction.

---

## 5. Keyboard

Three shortcuts, wired at the `window` level by
`attach_keybindings`:

- **Space** — toggle play/pause.
- **ArrowLeft** — skip −10s.
- **ArrowRight** — skip +10s.

The handler short-circuits when the event target is an `<input>` or
`<textarea>` so it doesn't steal keystrokes from form fields.
`e.code` (physical key, layout-independent) is the right choice for
positional shortcuts like Space and the arrows; `e.key` would be
correct only when the meaning *is* the printed character (`/` to
open search, `b` to bookmark).

`preventDefault()` on each handled key keeps Space from scrolling
the page and the arrows from moving a selection caret.

---

## 6. Media Session API

`attach_media_session` registers handlers with
`navigator.mediaSession` so the OS-level transport (lock screen,
notification, hardware media keys, Bluetooth headset, smartwatch)
controls playback:

- `play` / `pause` — proxy to the audio element.
- `seekforward` / `seekbackward` — ±10s, the same delta as the
  keyboard arrows.
- `previoustrack` / `nexttrack` — **rebound to sentence stepping**.
  This is the interesting one. For a reader, the natural "previous
  track" intuition isn't "back ten seconds," it's "the previous
  sentence." The handler finds the current sentence via
  `find_sentence_index_by_word(word_index)` and seeks to
  sentence ±1's first word.

`MediaMetadata` is set with the title and artist so the lock screen
shows "Abou Ben Adhem — Leigh Hunt" instead of the URL.
`setPositionState` is called on `play`, `pause`, `seeked`,
`ratechange`, and `loadedmetadata` so the scrub bar in the OS
control stays in sync; it's wrapped in `try/catch` because some
duration/position combos during load are rejected by Chromium.

Graceful fallback: if `navigator.mediaSession` is unavailable (older
Safari, SSR), the function returns a no-op controller and the rest
of the page is unaffected.

---

## 7. Persistence

The home page persists two things in `localStorage`: the user's
position and their playback rate, keyed by
`reading-highlight:abou-ben-adhem`.

- **Read** on mount, inside the same `$effect` that creates the
  playback controller. Wrapped in `try/catch` so corrupt or
  disabled storage doesn't break the page.
- **Write** on **`pagehide`**, not `beforeunload` and not every
  tick. `localStorage` is synchronous and blocks the main thread;
  writing on every frame tanks the sync loop. `pagehide` is the
  right event because it fires on tab close, navigation, *and*
  bfcache entry — `beforeunload` does not fire reliably on mobile
  Safari.

This is the entire persistence story for the home page. No
IndexedDB, no Cache API beyond the service worker, no cross-device
sync. The point is the *discipline*: pick the cheapest primitive
that gets the job done, write at natural pause points, never on
the hot path.

### Service worker

`/sw.js` is registered on mount:

```ts
if (browser && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
```

The `.catch(() => {})` is intentional — SW registration can fail
for a hundred reasons (file:// origin, insecure context, browser
config) and none of them should break the reader. The SW itself
handles whatever caching the project ships; the page-level concern
is registration and graceful failure.

### bfcache

`+layout.svelte` listens for `pageshow` with `e.persisted === true`
and logs a `bfcache.restore` event. The point isn't the log — it's
knowing that back/forward cache will hand the page back with all
state intact (audio element, reactive `$state`, DOM), and the only
thing to do is notice. If something needed to be re-fetched on
restore, this is the hook.

---

## 8. UI primitives

A scattering of small, deliberate choices:

- **`<blockquote cite="…">`** for the passage. The semantic element
  for quoted prose, with a machine-readable source URL. Beats
  `<div>` for free.
- **`<time datetime="PT1M23S">1:23</time>`** for elapsed/total time.
  ISO 8601 duration format in `datetime`; human-readable text
  content. AT, search, copy-paste all benefit.
- **`<input type="range">` for the scrubber.** Native, accessible,
  keyboard-operable, touchable. The fill is a CSS custom property
  `--fill` set inline from a `$derived` percentage — one source of
  truth, zero layout math.
- **`aria-label` on every icon button.** Play/pause swaps its label
  with its state so screen readers announce the current action.
- **`<span class="sr-only" aria-live="polite">`** announces the
  current word for AT users who have muted the TTS voice. The
  `sr-only` pattern (absolute, 1px box, clipped) keeps content in
  the accessibility tree where `display: none` would remove it.

### Reduced motion

There is no JS animation on the home page right now (the highlight
is a pure repaint each frame, no transitions). If you add a
sentence morph or a smooth-scroll-to-highlight later, gate
`behavior: 'smooth'` and any CSS transition on
`matchMedia('(prefers-reduced-motion: reduce)').matches`. Long
reader sessions and vestibular sensitivity are a bad combination.

---

## 9. Telemetry and error handling

The page wires structured logging through a thin OTel-style
console logger (`set_logger` in `+layout.svelte`,
`logger.event(name, attrs)` everywhere else). Every interesting
edge fires an event: `route.mounted`, `load.fetched`,
`audio.first_play`, `audio.error`, `audio.waiting`,
`playback.seek`, `playback.rate_changed`,
`playback.session_summary`, `state.restored`, `state.persisted`,
`media_session.action`, `passage.sentence_seek`,
`bfcache.restore`.

Two window-level error listeners catch the things that escape:

```ts
window.addEventListener('error', on_err);
window.addEventListener('unhandledrejection', on_rej);
```

Both feed the same `error.unhandled` event. The teardown removes
them, alongside the rAF cancel, the media session unhook, and the
keyboard unhook — the entire effect is symmetric, which is how you
avoid leaks across navigations in an SPA.

`session_summary` runs on teardown and reports `max_position`,
`seek_count`, and a `completed` fraction — the minimum useful
shape for "did the user actually engage with this document."

---

## 10. Interview cheat sheets

### The core five

**"How would you implement the highlight?"**
> `Range.getClientRects()` over the passage's text node, rendered
> as `<rect>` elements inside an `aria-hidden` SVG layered behind
> the prose. The text node stays untouched — no wrapping spans —
> so reader-mode extractors, screen readers, and selection all see
> the prose you authored. SVG over absolute-positioned `<div>`s
> for cleaner composition and `rx`/`ry` per-corner rounding. Three
> layers — hover sentence, active sentence, current word — painted
> in DOM order.

**"How do you keep the highlight in sync with audio?"**
> `requestAnimationFrame` reading `audio.currentTime`, then
> `findLastIndex(w => w.start <= t)` over the word table — largest
> index with `start ≤ t`. That semantics keeps the highlight on the
> previous word during silences and makes short words unmissable
> regardless of frame timing. Linear scan is fine for ~150 words;
> swap to binary search past ~10k. `timeupdate` is too coarse —
> ~4×/sec on Chrome.

**"How would you implement click-to-seek?"**
> `document.caretPositionFromPoint(x, y)`, confirm the hit node is
> the passage's text node, turn `(node, offset)` into a character
> index, look up the sentence with `find_sentence_index_by_offset`,
> then `audio.currentTime = timings[sentence.first_word_index].start`.
> The rAF loop does the rest. Sentence granularity over word
> granularity because a single word is too small a tap target.

**"What about lock-screen / hardware media keys?"**
> `navigator.mediaSession` with `setActionHandler` for play, pause,
> seekforward, seekbackward, previoustrack, nexttrack — the last
> two rebound to *previous sentence* and *next sentence* because
> "previous track" intuition in a reader is "previous sentence,"
> not "ten seconds back." `MediaMetadata` for the lock-screen label,
> `setPositionState` for the scrub bar in the OS control. Graceful
> no-op when `mediaSession` is unavailable.

**"How do you handle accessibility?"**
> The audio is the announcement, so `aria-live` is reserved for an
> optional positional fallback (the current word, for users who've
> muted TTS). No `tabindex` on decorative prose. The overlay SVG is
> `aria-hidden` with `pointer-events: none`, so AT sees the prose
> untouched. Semantic elements throughout — `<blockquote cite>`,
> `<time datetime>`, `<input type="range">`, `aria-label` on icon
> buttons. The `sr-only` pattern keeps invisible content in the
> AT tree where `display: none` wouldn't.

### Sync and timing

**"Why not `timeupdate`?"**
> Spec gives no minimum firing rate. Browsers ship ~4×/sec
> (Chrome, Firefox) to ~15×/sec (Safari). Below the word rate of
> normal speech, so the highlight visibly trails. `rAF` matches
> the display refresh, pauses in background tabs, and aligns with
> the compositor.

**"Why `findLastIndex`, not a forward pointer?"**
> A forward pointer is faster per-frame but breaks on scrubs.
> Every seek (drag, click-to-seek, keyboard skip) forces you to
> reset and re-walk. `findLastIndex` is correct under arbitrary
> seeking. The win on the pointer is illusory; you're optimising
> the wrong axis. For very long documents, swap the linear scan
> for binary search — same semantics, `O(log n)`.

**"Why `start ≤ t` and not `start ≤ t < end`?"**
> Speech has silences between words — punctuation pauses, breath
> pauses, sentence ends. `start ≤ t < end` makes the highlight
> blink off during every silence. `start ≤ t` (the largest such
> index) keeps it on the last word spoken, which is what a reader
> wants. Bonus: a short word can't be skipped by a frame landing
> in a 5 ms gap, because the search resolves to the most recent
> start.

**"The highlight feels a bit late. What do you do?"**
> Subtract a constant offset (60–100 ms) from `t` before the
> search to compensate for audio output latency. Bias *early* —
> leading the voice by a frame reads as in-sync; trailing reads
> as broken. If the lag is proportional rather than constant,
> your timing source is wrong; fix the data, not the highlight.

### Highlight rendering

**"Why `Range.getClientRects` instead of wrapping every word in a
span?"**
> Wrapping every word destroys the prose. A 200-word paragraph
> becomes 200+ empty spans; reader-mode extractors, screen
> crawlers, and selection all see markup instead of text. The
> range approach keeps `<blockquote>The text…</blockquote>`
> intact and paints the highlight in a sibling SVG layer that's
> `aria-hidden`.

**"Why SVG over absolute-positioned `<div>`s?"**
> One SVG node with many `<rect>` children composites more cleanly
> than N positioned divs, and `rx`/`ry` give per-corner rounding
> without per-element CSS. The semantics are identical — both are
> a sibling layer behind the prose — but the SVG is a smaller,
> denser representation.

**"Why not the CSS Custom Highlight API?"**
> Flat rectangles only. The API restricts you to `color`,
> `background-color`, `text-decoration` and friends, `text-shadow`,
> and `-webkit-text-stroke-*`. No `border-radius`, no padding, no
> transforms. The home page wants rounded pills, so it can't use
> the API. If the design were flat color (search hits, current
> line), the Highlight API would be the right call — zero DOM
> nodes is the cleanest possible story.

**"`Range.getClientRects()` — what's the gotcha?"**
> Coordinates are viewport-relative, so you must subtract the
> bounding rect of your positioned ancestor to draw into a local
> layer. And you must re-measure on resize, font load, and
> content change — a single `ResizeObserver` on the passage
> wrapper catches all three (it fires on internal layout shifts,
> not just viewport changes). Write the new rect into `$state`
> and let `$derived` consumers re-run. No manual invalidation.

### Click and hit-testing

**"User clicked between two words. What happens?"**
> `caretPositionFromPoint` returns the nearest text offset.
> `find_sentence_index_by_offset` maps the offset to a sentence
> by linear scan over the sentence spans, returning the
> previous sentence if the offset falls in a gap. Then seek to
> that sentence's `first_word_index`. Confirm the hit node is
> the passage's text node before doing anything — clicks on
> decoration or scrollbars shouldn't seek.

### Persistence

**"When do you write `localStorage`?"**
> On `pagehide`, not every tick. `localStorage` is synchronous
> and blocks the main thread; writing on every frame tanks the
> sync loop. `pagehide` is the right event because it fires on
> tab close, navigation, *and* bfcache entry — `beforeunload`
> doesn't fire reliably on mobile Safari. Wrapped in
> `try/catch` so disabled storage doesn't break the page.

**"Why not IndexedDB?"**
> Two strings — position and rate — don't justify it.
> `localStorage` is the right tool for small synchronous
> key-value state. IndexedDB earns its complexity for blobs
> (cached audio, downloaded utterances) and structured app
> state (timings JSON per document, bookmarks). The home page
> needs neither.

### Media Session

**"Why rebind previoustrack to previous sentence?"**
> Hardware media keys map to "previous track" by convention,
> but in a reader the unit the user thinks in is the sentence,
> not the track. ±10s is what the seek keys are for. Mapping
> prev/next track to sentence ±1 turns a single Bluetooth
> headset button into a native "step through the prose"
> control — the kind of integration that's invisible until
> someone hands you headphones with one button.

**"What if `mediaSession` is unavailable?"**
> Return a no-op controller from `attach_media_session`. The
> rest of the page is unaffected; the OS-level integration
> just isn't there. Graceful degradation, no feature
> detection at the call site.

### Accessibility

**"Why is there an `aria-live` announcing the current word?"**
> Fallback for AT users who have muted the TTS voice and want
> positional awareness from their own screen reader. Live
> regions are a debated choice here — double-speak is the risk
> — so the conservative move is to gate it behind a user
> setting. If your AT users overwhelmingly run with TTS on,
> remove it.

**"`display: none` vs the visually-hidden pattern?"**
> `display: none` and `visibility: hidden` remove from the
> accessibility tree. The clipped/1px-box `sr-only` pattern
> keeps content in the AT tree while hiding it visually. Use
> the latter for screen-reader-only labels, live regions,
> off-screen heading structure.

**"Why no `tabindex` on the passage?"**
> The hover/click decoration on prose is a *visual affordance
> for mouse users*. Adding `tabindex` puts a keyboard tab stop
> on the paragraph with nothing to do once focused. Keyboard
> users get the Space + arrow shortcuts instead, wired at the
> window level. If the prose ever carried a real action, wrap
> the trigger in a `<button>` or `<a>` and native focus
> styling does the work.

### System framing

**"Walk me through the architecture from server to highlight."**
> Server returns `{ text, ranges, words, sentences }` as JSON
> (or, in this prototype, a static file fetched in the page
> `load`). `<audio>` element streams the audio with progressive
> download. A `requestAnimationFrame` loop reads
> `audio.currentTime` into reactive state; `findLastIndex`
> produces the current word index; `find_sentence_index_by_word`
> derives the active sentence. The overlay effect calls
> `Range.getClientRects()` for three named ranges
> (hover/active/word), subtracts the passage origin, and writes
> `<rect>`s into an `aria-hidden` SVG. Click-to-seek runs
> `caretPositionFromPoint` → character offset →
> `find_sentence_index_by_offset` → `audio.currentTime`.
> Media Session API binds the OS transport. `localStorage`
> persists position and rate on `pagehide`.

**"If you had to ship in two days, what do you cut?"**
> Keep: `<audio>`, rAF + `findLastIndex`, `Range.getClientRects`
> rendered into SVG, click-to-seek with `caretPositionFromPoint`,
> `preservesPitch`, the keyboard shortcuts. Cut: Media Session,
> `aria-live` current-word fallback, bfcache logging, the
> structured telemetry, the service worker. The cut list is
> additive — each piece can ship as a follow-up without
> rearchitecting.

**"If you had a month, what's the highest-leverage thing you'd
add?"**
> Virtualization for long documents — a window of ±N sentences
> rendered, recycled as the highlight advances — because it
> unblocks novels and textbooks, the categories where the
> accessibility need is sharpest. After that, offline (cached
> audio + timings) and the `Selection` API for "play this
> paragraph." Visualizers and waveform rendering look
> impressive in demos and change the daily-use experience very
> little.

---

## 11. Reference index

- HTMLAudioElement — https://developer.mozilla.org/docs/Web/API/HTMLAudioElement
- HTMLMediaElement.playbackRate — https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/playbackRate
- HTMLMediaElement.preservesPitch — https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/preservesPitch
- requestAnimationFrame — https://developer.mozilla.org/docs/Web/API/Window/requestAnimationFrame
- Range — https://developer.mozilla.org/docs/Web/API/Range
- Range.getClientRects — https://developer.mozilla.org/docs/Web/API/Range/getClientRects
- ResizeObserver — https://developer.mozilla.org/docs/Web/API/ResizeObserver
- caretPositionFromPoint — https://developer.mozilla.org/docs/Web/API/Document/caretPositionFromPoint
- Media Session API — https://developer.mozilla.org/docs/Web/API/Media_Session_API
- MediaMetadata — https://developer.mozilla.org/docs/Web/API/MediaMetadata
- MediaSession.setPositionState — https://developer.mozilla.org/docs/Web/API/MediaSession/setPositionState
- Web Storage (localStorage) — https://developer.mozilla.org/docs/Web/API/Window/localStorage
- Page Visibility / pagehide — https://developer.mozilla.org/docs/Web/API/Window/pagehide_event
- Back/forward cache — https://web.dev/bfcache/
- Service Worker — https://developer.mozilla.org/docs/Web/API/Service_Worker_API
- aria-live — https://developer.mozilla.org/docs/Web/Accessibility/ARIA/Attributes/aria-live
- prefers-reduced-motion — https://developer.mozilla.org/docs/Web/CSS/@media/prefers-reduced-motion
- SVG `<rect>` — https://developer.mozilla.org/docs/Web/SVG/Element/rect
