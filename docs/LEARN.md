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
the runtime never touches [`Intl.Segmenter`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter). The TS surface that
matters is two tiny linear scans in `src/lib/tokenizer.ts`:
`find_sentence_index_by_offset` (used by click/hover hit-testing) and
`find_sentence_index_by_word` (used to derive the active sentence
from the current word).

---

## 1. Audio playback

### `<audio>` is enough

The home page reaches for [`HTMLAudioElement`](https://developer.mozilla.org/docs/Web/API/HTMLAudioElement) and nothing else. It
hands you progressive download, seeking, format negotiation, and a
[`currentTime`](https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/currentTime) that's accurate to well under a frame, all for free.
You only graduate to [Web Audio](https://developer.mozilla.org/docs/Web/API/Web_Audio_API) when you need something it can't give
you: visualizers, gapless concat across utterances, sample-accurate
scheduling, or compression.

The properties that matter in this reader cluster around one verb:
"touch the timeline*. `currentTime` is the spine of everything — you
read it every frame to drive the highlight, and you write it to seek.
[`playbackRate`](https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/playbackRate) is the knob the user actually grabs; the home page
cycles through `[0.75, 1, 1.25, 1.5, 2]`. The browser resamples
naively when you change it, though, so voices go chipmunky unless you
pair it with [`preservesPitch = true`](https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/preservesPitch) at construction. That pairing
isn't cosmetic: a dyslexic user reading at 1.5× hears a voice they
can't parse without it, which defeats the product. The remaining two
worth touching are [`duration`](https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/duration) and [`paused`](https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/paused), both pure UI state.

### Events we actually listen for

`create_playback` wires the full event surface:

- `play` / `pause` — drive the reactive `playing` flag.
- [`loadedmetadata`](https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/loadedmetadata_event) — `duration` isn't known until this fires.
- [`ended`](https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/ended_event) — telemetry only; UI keeps the highlight where it landed.
- `error` — inspect [`audio.error.code`](https://developer.mozilla.org/docs/Web/API/MediaError) (the `MEDIA_ERR_*` family) and
  log. A 403 mid-playback shouldn't reset the user's place.
- [`waiting`](https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/waiting_event) / [`canplaythrough`](https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/canplaythrough_event) — telemetry signals for buffering
  trouble; useful when interpreting reports of "the highlight froze."

The event you'll notice missing is **[`timeupdate`](https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/timeupdate_event)**. The spec lets
the browser fire it whenever; in practice you get 4–15 firings per
second. That's slower than most short words, so the highlight
visibly trails the voice. We use [`requestAnimationFrame`](https://developer.mozilla.org/docs/Web/API/Window/requestAnimationFrame) instead
(§2).

### Accessibility implications

The audio *is* the accessibility feature. The page exposes a single
[`aria-live="polite"`](https://developer.mozilla.org/docs/Web/Accessibility/ARIA/Attributes/aria-live) region with the current word — that's a
deliberate, debated choice. The defensible reading is: the live
region is a fallback for screen-reader users who have muted the TTS
voice and want positional awareness from their own AT. If that
double-speak is a problem in your environment, the live region is
the first thing to gate behind a setting. Live regions otherwise
belong on app-level events (playback paused, end of chapter), not
the per-word stream.

---

## 2. The time-sync loop

The home page runs one loop: an [`<audio>`](https://developer.mozilla.org/docs/Web/API/HTMLAudioElement) element, a
[`requestAnimationFrame`](https://developer.mozilla.org/docs/Web/API/Window/requestAnimationFrame) tick that copies [`audio.currentTime`](https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/currentTime) into
reactive state, and a derived computation that turns that time into a
word index.

### Why `requestAnimationFrame`

It's tied to the display refresh, it pauses in background tabs (so a
hidden tab doesn't burn CPU advancing a highlight nobody can see),
and it aligns with the compositor — meaning your DOM writes land on
the same frame the browser is about to paint. [`setInterval`](https://developer.mozilla.org/docs/Web/API/setInterval) does
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

The home page does a linear [`findLastIndex`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array/findLastIndex) over ~150 words. That's
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
rounded [`<rect>`](https://developer.mozilla.org/docs/Web/SVG/Element/rect) elements inside a single [SVG](https://developer.mozilla.org/docs/Web/SVG/Element/svg) that sits behind the
unmodified prose.

```ts
const range = document.createRange();
range.setStart(text_node, start);
range.setEnd(text_node, end);
for (const r of range.getClientRects()) { ... }
```

The killer method. Given any [`Range`](https://developer.mozilla.org/docs/Web/API/Range) over text — even a sub-range
that isn't aligned to any element boundary — the browser hands you
one `DOMRect` per line-box. You take those rects, subtract the
offset of a positioned ancestor, and render them as
absolute-positioned shapes in a layer *behind* the text.

The home page renders into **SVG** rather than absolute-positioned
`<div>`s. The trade is small but real: one SVG node with many
`<rect>` children composites a hair more efficiently than N
positioned divs, and [`rx`/`ry`](https://developer.mozilla.org/docs/Web/SVG/Attribute/rx) give per-corner rounding without CSS
per element. The overlay is one `<svg aria-hidden="true">` ([`aria-hidden`](https://developer.mozilla.org/docs/Web/Accessibility/ARIA/Attributes/aria-hidden)) with
three groups of `<rect>` — `.hover`, `.active`, `.word` — painted in
DOM order so word sits on top of sentence sits on top of hover.

### Why this technique

- **The prose stays as you wrote it.** [`<blockquote class="passage" cite="…">The text…</blockquote>`](https://developer.mozilla.org/docs/Web/HTML/Element/blockquote) survives untouched. No wrapping
  spans, no hundred nodes per paragraph. Reader-mode extractors,
  search crawlers, screen readers, and your future self all see the
  prose you authored.
- **Sub-range freedom.** You can highlight any character range,
  whether or not it aligns to an element. The technique doesn't
  care.
- **Full styling freedom.** Unlike the [CSS Custom Highlight API](https://developer.mozilla.org/docs/Web/API/CSS_Custom_Highlight_API)
  (which restricts you to `color`, `background-color`,
  `text-decoration`, `text-shadow`, and the
  `-webkit-text-stroke-*` family — no `border-radius`, no padding),
  SVG `<rect>` gives you rounded corners, strokes, gradients,
  filters, anything paintable.

The two techniques you'd reach for instead:

- `box-decoration-break: clone` on inline spans — pure CSS, wraps
  per line for free, **but** requires wrapping the highlight target
  in an element, which destroys clean prose markup. Requies splitting
  text into as many [`<span>`](https://developer.mozilla.org/docs/Web/HTML/Element/span) as the text is. So, that's a lot
- CSS Custom Highlight API — zero DOM nodes, the cleanest possible
  story, **but** flat rectangles only and Firefox support was
  flagged for a long time. Right answer when you want a search-hit
  style highlight on text that must stay pristine.

### Coordinates and the BLEED

[`getClientRects()`](https://developer.mozilla.org/docs/Web/API/Range/getClientRects) returns viewport-relative rectangles. The home
page keeps the passage's bounding rect in `passage_rect` state
(see §3 *Re-measure on reflow*), exposes it as a `$derived`
`origin = { x: passage_rect.left, y: passage_rect.top }`, and
subtracts it from every rect so the SVG draws in local coordinates.
A small `PAD_X = 3` / `PAD_Y = 2` is added so the painted rect is
slightly larger than the glyph box (matches the visual intuition of
a highlight that *contains* the word). The wrapping SVG carries a
`BLEED = 10` margin via its [`viewBox`](https://developer.mozilla.org/docs/Web/SVG/Attribute/viewBox) so the rects at the edge of
the passage aren't clipped, and the SVG's CSS positions it with
`top: -10px; left: -10px; overflow: visible`.

### Re-measure on reflow

Costs you take on with `getClientRects`: you must re-measure on
resize, on font load, on any content change. The home page wires a
single [`ResizeObserver`](https://developer.mozilla.org/docs/Web/API/ResizeObserver) on the passage wrapper and stores the
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

The overlay SVG is `aria-hidden="true"` with [`pointer-events: none`](https://developer.mozilla.org/docs/Web/CSS/pointer-events).
Selection and AT both see the underlying prose, untouched. Clicks
land on the text node (§4); the SVG never intercepts them. The
visual depends on JS — if scripts fail, the prose stays readable
but the highlight vanishes. That's graceful degradation, not
failure, but it's worth naming in interviews.

### Why not [`Range.surroundContents()`](https://developer.mozilla.org/docs/Web/API/Range/surroundContents)

It throws `InvalidStateError` if the range crosses any element
boundary. The moment your text contains a single inline `<strong>`,
[`<a>`](https://developer.mozilla.org/docs/Web/HTML/Element/a), or previous wrapper, you crash. Useful for "wrap a fresh
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

[`document.caretPositionFromPoint(x, y)`](https://developer.mozilla.org/docs/Web/API/Document/caretPositionFromPoint) returns
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

### The [`Selection`](https://developer.mozilla.org/docs/Web/API/Selection) API is not wired here

The home page does not yet listen for [`selectionchange`](https://developer.mozilla.org/docs/Web/API/Document/selectionchange_event) or expose a
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
[`e.code`](https://developer.mozilla.org/docs/Web/API/KeyboardEvent/code) (physical key, layout-independent) is the right choice for
positional shortcuts like Space and the arrows; `e.key` would be
correct only when the meaning *is* the printed character (`/` to
open search, `b` to bookmark).

`preventDefault()` on each handled key keeps Space from scrolling
the page and the arrows from moving a selection caret.

---

## 6. Media Session API

`attach_media_session` registers handlers with
[`navigator.mediaSession`](https://developer.mozilla.org/docs/Web/API/Media_Session_API) so the OS-level transport (lock screen,
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

[`MediaMetadata`](https://developer.mozilla.org/docs/Web/API/MediaMetadata) is set with the title and artist so the lock screen
shows "Abou Ben Adhem — Leigh Hunt" instead of the URL.

### [`setPositionState`](https://developer.mozilla.org/docs/Web/API/MediaSession/setPositionState)

`navigator.mediaSession.setPositionState({ duration, playbackRate,
position })` tells the OS where playback currently is. Without it,
the system control knows *whether* audio is playing but not
*where* — the scrub bar sits frozen, the "skip 10s" preview shows
nothing useful, and AirPlay receivers can't render an accurate
timeline.

The page calls it on five audio events: `play`, `pause`, `seeked`,
`ratechange`, `loadedmetadata`. That covers every moment the OS's
view of the position could diverge from reality. It is wrapped in
`try/catch` because Chromium throws if the duration is `NaN` or
the position falls outside `[0, duration]` — both common during
the brief window before metadata loads.

There is also a `typeof ms.setPositionState !== 'function'` guard
because the method shipped after the rest of the API.

##### Support

The Media Session API itself is in Chrome 73+,
Edge 79+, Firefox 82+, and Safari 15+ (desktop and iOS).
`setPositionState` specifically is in Chrome 81+, Edge 81+,
Firefox 109+, and Safari 15.4+. Anything older falls into the
graceful no-op path below. Mobile Safari and Chrome on Android
are where this matters most in practice — that's where the lock
screen and Bluetooth controls are surfacing the data.

Graceful fallback: if `navigator.mediaSession` is unavailable
(SSR, very old browsers), the function returns a no-op controller
and the rest of the page is unaffected.

---

## 7. Persistence

The home page persists two things in [`localStorage`](https://developer.mozilla.org/docs/Web/API/Window/localStorage): the user's
position and their playback rate, keyed by
`reading-highlight:abou-ben-adhem`.

- **Read** on mount, inside the same `$effect` that creates the
  playback controller. Wrapped in `try/catch` so corrupt or
  disabled storage doesn't break the page.
- **Write** on **[`pagehide`](https://developer.mozilla.org/docs/Web/API/Window/pagehide_event)**, not [`beforeunload`](https://developer.mozilla.org/docs/Web/API/Window/beforeunload_event) and not every
  tick. `localStorage` is synchronous and blocks the main thread;
  writing on every frame tanks the sync loop. `pagehide` is the
  right event because it fires on tab close, navigation, *and*
  bfcache entry — `beforeunload` does not fire reliably on mobile
  Safari.

This is the entire persistence story for the home page. No
[IndexedDB](https://developer.mozilla.org/docs/Web/API/IndexedDB_API), no Cache API beyond the [service worker](https://developer.mozilla.org/docs/Web/API/Service_Worker_API), no cross-device
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

##### What it is

"bfcache" is short for *[back/forward cache](https://web.dev/bfcache/)*. When
you navigate away from a page and then press the browser's Back
(or Forward) button, modern browsers don't reload the previous
page from scratch — they keep a *snapshot* of it in memory,
fully alive, and slot it back in. The audio element, scroll
position, JavaScript variables, DOM nodes — everything is exactly
where you left it. The page didn't reload; it was paused and
resumed. This is why hitting Back on a YouTube video can drop you
straight back into playback at the same second.

##### Why it matters here

Because the snapshot is live, the
reader's audio, highlight position, and reactive `$state` survive
a Back/Forward round trip with zero work on our part. That's the
ideal — *no code needed* to restore state, because state was
never lost.

##### How you detect it

The browser fires a [`pageshow`](https://developer.mozilla.org/docs/Web/API/Window/pageshow_event) event every
time the page becomes visible — both on a normal load *and* on a
bfcache restore. To tell which one it is, you read the event's
`persisted` flag: `true` means "this page came back from the
bfcache," `false` means "this is a fresh load."

```ts
window.addEventListener('pageshow', (e) => {
  if (e.persisted) logger.event('bfcache.restore', { persisted: true });
});
```

##### What the code does with that

Just logs it. The point isn't
the log itself — it's the hook. If you ever need to do work
*only* on a bfcache restore (re-validate a token, re-open a
WebSocket, refresh a timestamp), this is the event that fires.
Today the reader needs none of those, so we record the event for
telemetry and move on.

(Counterpart: bfcache *entry* fires `pagehide` with
`event.persisted === true`. That's why `pagehide` — not
`beforeunload` — is also the right place to write to
`localStorage`; see §7.)

---

## 8. UI primitives

A scattering of small, deliberate choices:

- **[`<blockquote cite="…">`](https://developer.mozilla.org/docs/Web/HTML/Element/blockquote)** for the passage. The semantic element
  for quoted prose, with a machine-readable source URL. Beats
  `<div>` for free.
- **[`<time datetime="PT1M23S">1:23</time>`](https://developer.mozilla.org/docs/Web/HTML/Element/time)** for elapsed/total time.
  ISO 8601 duration format in `datetime`; human-readable text
  content. AT, search, copy-paste all benefit.
- **[`<input type="range">`](https://developer.mozilla.org/docs/Web/HTML/Element/input/range) for the scrubber.** Native, accessible,
  keyboard-operable, touchable. The fill is a CSS custom property
  `--fill` set inline from a `$derived` percentage — one source of
  truth, zero layout math.
- **[`aria-label`](https://developer.mozilla.org/docs/Web/Accessibility/ARIA/Attributes/aria-label) on every icon button.** Play/pause swaps its label
  with its state so screen readers announce the current action.
- **`<span class="sr-only" aria-live="polite">`** ([`aria-live`](https://developer.mozilla.org/docs/Web/Accessibility/ARIA/Attributes/aria-live)) announces the
  current word *only when the audio narration isn't the voice* —
  i.e. when playback is paused, muted, or volume is zero
  (`playback.audible` is false). When the recording is actively
  audible, the span emits an empty string so the screen reader
  doesn't echo what the user is already hearing. The `sr-only`
  pattern (absolute, 1px box, clipped) keeps content in the
  accessibility tree where [`display: none`](https://developer.mozilla.org/docs/Web/CSS/display) would remove it.

### ISO 8601 durations in `<time datetime="…">`

`<time>` is the HTML element for "this text is a time value." Its
optional `datetime` attribute is the *machine-readable* version of
that value — what screen readers, search engines, and other tools
parse — while the element's text content is the *human-readable*
version. The two are decoupled on purpose: `"1:23"` is what a
sighted user wants to see; `"PT1M23S"` is what a parser needs to
know it means "one minute and twenty-three seconds."

The format in `datetime` is **ISO 8601 duration syntax**, the same
standard used by APIs, calendars, and databases worldwide. The
letters aren't arbitrary:

- `P` — **P**eriod. Every duration starts with this. It's the
  marker that says "what follows is a length of time," not a
  point in time.
- `T` — **T**ime. Separates the date portion (years, months,
  days) from the time portion (hours, minutes, seconds). For
  audio you only need the time portion, so durations look like
  `PT…`. (A full duration could be `P1DT2H30M` — 1 day, 2 hours,
  30 minutes.)
- `H` / `M` / `S` — hours, minutes, seconds. Each preceded by its
  number. Zero-valued units are omitted: `PT45S` for 45 seconds
  flat, `PT1H` for one hour, `PT0S` for the initial "0:00".

So `<time datetime="PT1M23S">1:23</time>` means:
"the text 1:23 represents a duration of 1 minute, 23 seconds."

##### Why bother?

A few concrete payoffs:

- **Screen readers** can announce "one minute twenty-three
  seconds" instead of literally reading "one colon two three".
- **Search engines** parse `<time datetime>` into structured
  metadata; a podcast directory or rich result can know the episode
  is `PT12M` long without scraping text.
- **Copy/paste & calendar integrations** can recognise the value
  and offer "add to calendar" / "set timer" actions.
- **Locale-independence**: `1:23` could be a clock time in some
  locales; `PT1M23S` is unambiguous everywhere.

The cost is one attribute. Worth it.

### Reduced motion

There is no JS animation on the home page right now (the highlight
is a pure repaint each frame, no transitions). If you add a
sentence morph or a smooth-scroll-to-highlight later, gate
`behavior: 'smooth'` and any CSS transition on
`matchMedia('(prefers-reduced-motion: reduce)').matches` ([`matchMedia`](https://developer.mozilla.org/docs/Web/API/Window/matchMedia), [`prefers-reduced-motion`](https://developer.mozilla.org/docs/Web/CSS/@media/prefers-reduced-motion)). Long
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

Two window-level error listeners catch the things that escape try/catch:

```ts
const on_err = (e: ErrorEvent) => {
  logger.event('error.unhandled', { message: e.message, src: e.filename });
};
const on_rej = (e: PromiseRejectionEvent) => {
  logger.event('error.unhandled', { message: String(e.reason) });
};
window.addEventListener('error', on_err);
window.addEventListener('unhandledrejection', on_rej);
```

[`error`](https://developer.mozilla.org/docs/Web/API/Window/error_event) ([`ErrorEvent`](https://developer.mozilla.org/docs/Web/API/ErrorEvent)) fires for synchronous throws that escape; [`unhandledrejection`](https://developer.mozilla.org/docs/Web/API/Window/unhandledrejection_event) ([`PromiseRejectionEvent`](https://developer.mozilla.org/docs/Web/API/PromiseRejectionEvent))
fires for Promises that reject with no `.catch`. They're two
separate browser events for historical reasons, and you need both —
listening to only one drops half your crashes. Each handler just
reads a couple of fields off the event object and forwards them to
`logger.event` under the same `error.unhandled` name, so your
telemetry has one error stream instead of two. The handlers
themselves are pure observability: they don't recover, they don't
show UI, they don't swallow anything (the error still surfaces in
the devtools console). They exist so a crash on a user's device
becomes a row in your logs rather than dying silently.

The teardown removes both listeners, alongside the rAF cancel, the
media session unhook, and the keyboard unhook — the entire effect
is symmetric, which is how you avoid leaks across navigations in
an SPA. [`removeEventListener`](https://developer.mozilla.org/docs/Web/API/EventTarget/removeEventListener) needs the same function reference you
passed to [`addEventListener`](https://developer.mozilla.org/docs/Web/API/EventTarget/addEventListener), which is why `on_err` / `on_rej` are
stored in named `const`s rather than inlined as arrow expressions.

`session_summary` runs on teardown and reports `max_position`,
`seek_count`, and a `completed` fraction — the minimum useful
shape for "did the user actually engage with this document."

---

## 10. Interview cheat sheets

### The core five

#### "How would you implement the highlight?"
The constraint I'd start from: the prose has to stay a single
text node — reader mode, screen readers, and Select-All all need
it intact. So wrapping each word in a [`<span>`](https://developer.mozilla.org/docs/Web/HTML/Element/span) is off the table.

The trick is [`Range.getClientRects()`](https://developer.mozilla.org/docs/Web/API/Range/getClientRects). I'd make a [Range](https://developer.mozilla.org/docs/Web/API/Range) over a
slice of the text, ask the browser for the bounding rects, and
paint them in a sibling [`aria-hidden`](https://developer.mozilla.org/docs/Web/Accessibility/ARIA/Attributes/aria-hidden) [SVG](https://developer.mozilla.org/docs/Web/SVG/Element/svg) behind the text —
[`<rect>`](https://developer.mozilla.org/docs/Web/SVG/Element/rect) elements with [`rx`/`ry`](https://developer.mozilla.org/docs/Web/SVG/Attribute/rx) for rounded pills. The original
text node would never be touched.

Happy to dig into [the SVG-vs-divs choice](#why-svg-over-absolute-positioned-divs),
[how I'd re-measure on reflow](#rangegetclientrects--whats-the-gotcha),
or [why I'd skip the CSS Custom Highlight API](#why-not-the-css-custom-highlight-api).

##### "Why `Range.getClientRects` instead of wrapping every word in a span?"
The instinct is to wrap each word: `<span>Abou</span> <span>Ben</span>
<span>Adhem</span>…`. It works for highlighting, but it destroys
the prose. A 200-word paragraph becomes 200+ empty spans —
reader-mode extractors, AT crawlers, even plain Select-All now
see markup instead of text.

`Range.getClientRects()` lets you ask the browser "where would
this slice of the text node be painted?" without modifying the
DOM at all. The text stays a single
`<blockquote>The text…</blockquote>`, and the highlight lives in
a sibling `aria-hidden` SVG layer the prose doesn't know about.

##### "Why SVG over absolute-positioned `<div>`s?"
One SVG node with many `<rect>` children composites more cleanly
than N positioned divs, and `rx`/`ry` give per-corner rounding
without per-element CSS. The semantics are identical — both are
a sibling layer behind the prose — but the SVG is a smaller,
denser representation.

##### "`Range.getClientRects()` — what's the gotcha?"
Two gotchas, both about coordinates and freshness.

First, the coordinates are viewport-relative. If your overlay
is positioned inside a wrapper, you have to subtract that
wrapper's bounding rect from every glyph rect to translate into
the overlay's local space. Easy to forget on the first pass;
shows up as the highlight appearing offset by some scroll
amount.

Second, the rects go stale on anything that changes layout —
viewport resize, font load, content change, ancestor width
shifts. A [`ResizeObserver`](https://developer.mozilla.org/docs/Web/API/ResizeObserver) on the passage wrapper catches all
of those at once; it fires on internal layout shifts, not just
viewport changes. Write the new rect into reactive state and
let derived consumers re-run on their own. No manual
invalidation, no tick counters.

##### "Why not the CSS Custom Highlight API?"
Flat rectangles only. The API restricts you to `color`,
`background-color`, `text-decoration` and friends, `text-shadow`,
and `-webkit-text-stroke-*`. No `border-radius`, no padding, no
transforms. I'd want rounded pills for the highlight, so the API
wouldn't fit. If the design were flat color (search hits, current
line), the Highlight API would be the right call — zero DOM
nodes is the cleanest possible story.

#### "How would you keep the highlight in sync with audio?"
The naive instinct is to listen for [`timeupdate`](https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/timeupdate_event) on the audio
element. But it fires maybe four times a second — well below the
rate of normal speech, so the highlight visibly trails the voice.

So instead I'd run a [`requestAnimationFrame`](https://developer.mozilla.org/docs/Web/API/Window/requestAnimationFrame) loop. Each frame:
read [`audio.currentTime`](https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/currentTime), find the last word whose `start` ≤ that
time, update the index. `rAF` matches the display refresh, pauses
in background tabs, and would make the highlight feel like it *is*
the audio rather than chasing it.

The "last word whose start ≤ t" semantics has a couple of nice
properties — happy to go into [why that's the right comparison rather than `start ≤ t < end`](#why-start--t-and-not-start--t--end),
or [how this scales for longer documents](#how-does-this-scale-for-longer-documents).

##### "Why not `timeupdate`?"
Spec gives no minimum firing rate. Browsers ship ~4×/sec
(Chrome, Firefox) to ~15×/sec (Safari). Below the word rate of
normal speech, so the highlight visibly trails. `rAF` matches
the display refresh, pauses in background tabs, and aligns with
the compositor.

##### "Why `findLastIndex`, not a forward pointer?"
A forward pointer is an index I'd keep between frames that only
moves forward as time advances — instead of searching the whole
array every frame, I remember which word I'm on and just check
whether we've passed the next one yet. Per-frame cost is O(1)
amortised because the pointer only ever increases.

The catch is it only works if time moves forward monotonically.
Every seek (drag, click-to-seek, keyboard skip) jumps
`current_time` backwards, the pointer goes stale, and I have to
detect the seek and re-walk from zero. [`findLastIndex`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array/findLastIndex) is
stateless and correct under arbitrary seeking, so the win on the
pointer is illusory; I'd be optimising the wrong axis. For very
long documents, swap the linear scan for binary search — same
semantics, `O(log n)`.

##### "When does the highlight move to the next word?"
The honest answer is: when the *next* word starts, not when the
current one ends. Those sound equivalent and they aren't. Speech
has silences all over it — punctuation pauses, breath pauses,
sentence boundaries — and if I tie the highlight to "while this
word is being spoken" it blinks off in every one of those gaps.
A reader watching the page sees the highlight stutter, which
reads as broken even though the audio is fine.

So I don't ask "is `t` inside this word's interval." I ask "what
was the last word that started." The current word stays
highlighted right up to the moment the next one begins, the
silences disappear from the UI, and short words can't be skipped
by a frame landing in a 5 ms gap because the search always
resolves to the most recent start.

##### "The highlight feels a bit late. What would you do?"
I'd subtract a constant offset (60–100 ms) from `t` before the
search to compensate for audio output latency. The bias should
be *early* — leading the voice by a frame reads as in-sync;
trailing reads as broken. If the lag is proportional rather than
constant, the timing source is wrong; I'd fix the data, not the
highlight.

##### "How does this scale for longer documents?"
The home page does a linear `findLastIndex` over ~150 words —
roughly 150 comparisons per frame, completely invisible. For a
10k-word document that's 10k comparisons at 60 Hz, ~14 ms wasted
per second, which starts to bite the frame budget.

I'd swap the linear scan for a [binary search](#how-does-binary-search-work-could-you-explain-it-to-me)
at that point — same `start ≤ t` semantics, but `O(log n)`. For
10k words that's ~14 comparisons instead of 10k, and the upgrade
is local: the caller doesn't change, only the search function
does.

The principle: optimise when the size demands it, not before.
The call-site comment in the codebase actually marks this
upgrade path explicitly, so the next person on the file knows
where the line is.

##### "How does binary search work? Could you explain it to me?"
The setup that makes it work: `timings` is sorted by `start`
ascending — word `i+1` always starts after word `i`. That
ordering is the whole reason binary search applies. Linear scan
doesn't need it; binary search lives or dies by it.

The idea is: instead of checking every word, I look at the
middle one. If its `start` is `≤ t`, the answer I'm looking for
is either that word or somewhere to its right, so I throw away
the left half. If its `start` is `> t`, the answer is to the
left, so I throw away the right half. Then I do the same thing
on whichever half is left. Each step halves the search space, so
10k words collapses in ~14 steps instead of 10k.

What I'm computing is still "largest index `i` such that
`words[i].start ≤ t`" — exactly what `findLastIndex` returns,
just reached by halving instead of scanning. The tricky bit is
the loop invariant: I track a `lo` and `hi`, and on each `≤ t`
hit I move `lo` past the midpoint (because the midpoint is a
*valid* candidate, but there might be a better one further
right), and on each `> t` miss I pull `hi` back to the midpoint.
When `lo` and `hi` meet, `lo - 1` is the answer.

The reason that's worth getting right: an off-by-one in this
loop doesn't crash — it just highlights the wrong word, which
looks like a sync bug. The semantics have to match the linear
version exactly, or the upgrade isn't local anymore.

#### "How would you implement click-to-seek?"
First decision I'd make: sentence granularity, not word. A single
word is too small a touch target — you'd miss-tap constantly.
Sentences are big, finger-friendly, and they match how people
think about "where I want to be" in prose.

Then it's [`document.caretPositionFromPoint(x, y)`](https://developer.mozilla.org/docs/Web/API/Document/caretPositionFromPoint) — you give it
screen coordinates, it hands back the text node and character
offset under the cursor. I'd confirm the hit is actually the
prose (not the overlay or some padding), map that offset to a
sentence index, and set `audio.currentTime` to the start of that
sentence's first word. The rAF sync loop would catch up on the
next frame; I wouldn't have to touch the highlight myself.

Happy to go deeper on [the caret API itself](#what-does-caretpositionfrompoint-do-exactly),
or [how I'd handle clicks that land between two words](#user-clicked-between-two-words-what-happens).

##### "What does `caretPositionFromPoint` do, exactly?"
You hand it `(x, y)` in client coordinates and it hands back
`{ offsetNode, offset }` — the text node under that point and
the character offset inside it. That's the whole API. The
browser walks its layout tree, figures out which glyph (or gap
between glyphs) sits at those pixels, and tells you the
corresponding character position.

It's the modern, standardised version of what used to be
browser-specific. Supported across current Firefox, Chromium,
and Safari. There used to be an older `caretRangeFromPoint`
that returned a `Range` instead, but it's deprecated; modern
code only needs the one call.

The thing to remember: it doesn't filter for "the element you
care about." It happily returns offsets inside an overlay SVG,
padding, scrollbars, whatever is at the cursor. So before
trusting the result you confirm `pos.offsetNode === my_passage_text_node`.
Otherwise a click on decoration triggers a seek you didn't want.

##### "User clicked between two words. What happens?"
The browser doesn't care about word boundaries —
`caretPositionFromPoint` just hands back the nearest text
offset. A click in a gap returns whichever character offset is
closest, typically the start of the next word.

From there, `find_sentence_index_by_offset` walks the sentence
spans and answers "which span contains this offset, or — if
we're in a gap — the previous one." That fallback is the point:
clicks on whitespace shouldn't fall off the end. Then I seek to
that sentence's first word.

The check I always remember to do: confirm the hit node is
actually the passage's text node. Clicks on the overlay,
scrollbar, or padding shouldn't trigger a seek.

#### "What about lock-screen / hardware media keys?"
I'd reach for the [Media Session API](https://developer.mozilla.org/docs/Web/API/Media_Session_API). You register handlers on
`navigator.mediaSession` for play, pause, seek-forward,
seek-backward, previous-track, next-track. The OS then surfaces
those in its native control — lock screen, notification,
Bluetooth headset, smartwatch — and routes the user's button
presses back to your handlers.

The interesting bit is "previous track" and "next track." For a
podcast those mean "previous episode." For a reader, the
intuition is "previous sentence." So I'd rebind them to sentence
stepping instead of episode skipping. [`MediaMetadata`](https://developer.mozilla.org/docs/Web/API/MediaMetadata) would set
the label on the lock screen; [`setPositionState`](https://developer.mozilla.org/docs/Web/API/MediaSession/setPositionState) would keep the
OS's scrub bar in sync with where playback actually is.

Happy to go into [`setPositionState` specifically — its support story and why it needs a `try/catch`](#whats-setpositionstate-and-why-the-trycatch).

##### "What's `setPositionState`, and why the `try/catch`?"
`navigator.mediaSession.setPositionState({ duration, playbackRate, position })`
tells the OS where playback currently is. Without it, the
system control knows *whether* audio is playing but not
*where* — the scrub bar sits frozen, "skip 10s" indicators are
inaccurate, AirPlay receivers can't render a timeline. The page
calls it on five events: `play`, `pause`, `seeked`, `ratechange`,
`loadedmetadata` — anywhere the OS's view of position could
diverge from reality.

The `try/catch` exists because Chromium throws when the values
are inconsistent. `NaN` duration, position past duration, or
playbackRate of zero — any of those raise. That state happens
routinely during the brief window before `loadedmetadata` fires,
when `audio.duration` is still `NaN`. Catching prevents a benign
init-time race from logging as an error.

Support: this method shipped after the rest of the API. Chrome
81+, Edge 81+, Firefox 109+, Safari 15.4+. So there's also a
`typeof ms.setPositionState !== 'function'` guard — otherwise
older browsers that have Media Session but lack this method hit
a `TypeError`.

##### "Why rebind `previoustrack` to previous sentence?"
Hardware media keys map to "previous track" by convention,
but in a reader the unit the user thinks in is the sentence,
not the track. ±10s is what the seek keys are for. Mapping
prev/next track to sentence ±1 turns a single Bluetooth
headset button into a native "step through the prose"
control — the kind of integration that's invisible until
someone hands you headphones with one button.

##### "What if `mediaSession` is unavailable?"
I'd return a no-op controller from `attach_media_session`. The
rest of the page would be unaffected; the OS-level integration
just wouldn't be there. Graceful degradation, no feature
detection at the call site.

#### "How would you handle accessibility?"
The big realisation I'd lead with: the audio narration *is* the
accessibility story for the prose. A screen-reader user can hear
the recording — so I wouldn't want the screen reader to ALSO
announce every word. That's a duplicate voice.

Concretely: I'd put `aria-hidden` and `pointer-events: none` on
the highlight overlay, so assistive tech only sees the underlying
prose, and clicks land on the text node rather than the SVG. I'd
add a single [`aria-live`](https://developer.mozilla.org/docs/Web/Accessibility/ARIA/Attributes/aria-live) region that announces the current word,
gated so it only fires when the audio isn't audible — paused,
muted, or volume zero. One voice at a time.

The rest is just semantic HTML: [`<blockquote cite>`](https://developer.mozilla.org/docs/Web/HTML/Element/blockquote) for the
passage, [`<time datetime>`](https://developer.mozilla.org/docs/Web/HTML/Element/time) for elapsed time, [`<input type="range">`](https://developer.mozilla.org/docs/Web/HTML/Element/input/range)
for the scrubber, [`aria-label`](https://developer.mozilla.org/docs/Web/Accessibility/ARIA/Attributes/aria-label) on icon buttons. Happy to walk
through any of those, or [the `sr-only` pattern specifically](#display-none-vs-the-visually-hidden-pattern).

##### "Why would you add an `aria-live` announcing the current word?"
Because the audio recording is the primary accessibility story,
but only when the user is actually hearing it. If they've paused,
muted, or dropped the volume to zero, the screen reader becomes
the only voice — and without a live region, they'd get no signal
at all about where in the prose playback is.

So I'd add one `aria-live="polite"` region announcing the
current word, gated on whether the audio is audible. When the
audio is playing at volume, the region would emit an empty
string and stay silent. When the audio isn't audible, it would
emit the current word. One voice at a time — never both.

##### "`display: none` vs the visually-hidden pattern?"
[`display: none`](https://developer.mozilla.org/docs/Web/CSS/display) and [`visibility: hidden`](https://developer.mozilla.org/docs/Web/CSS/visibility) remove from the
accessibility tree. The clipped/1px-box `sr-only` pattern
keeps content in the AT tree while hiding it visually. Use
the latter for screen-reader-only labels, live regions,
off-screen heading structure.

##### "Why no `tabindex` on the passage?"
The hover/click decoration on prose is a *visual affordance
for mouse users*. Adding [`tabindex`](https://developer.mozilla.org/docs/Web/HTML/Global_attributes/tabindex) puts a keyboard tab stop
on the paragraph with nothing to do once focused. Keyboard
users get the Space + arrow shortcuts instead, wired at the
window level. If the prose ever carried a real action, wrap
the trigger in a [`<button>`](https://developer.mozilla.org/docs/Web/HTML/Element/button) or [`<a>`](https://developer.mozilla.org/docs/Web/HTML/Element/a) and native focus
styling does the work.

### Persistence

#### "When would you write to `localStorage`?"
On [`pagehide`](https://developer.mozilla.org/docs/Web/API/Window/pagehide_event), not every tick. [`localStorage`](https://developer.mozilla.org/docs/Web/API/Window/localStorage) is synchronous and
blocks the main thread; writing on every frame would tank the
sync loop. `pagehide` is the right event because it fires on tab
close, navigation, *and* [bfcache](https://web.dev/bfcache/) entry — [`beforeunload`](https://developer.mozilla.org/docs/Web/API/Window/beforeunload_event) doesn't
fire reliably on mobile Safari. I'd wrap the write in `try/catch`
so disabled storage doesn't break the page.

#### "Why not IndexedDB?"
Two strings — position and rate — don't justify it.
`localStorage` is the right tool for small synchronous
key-value state. [IndexedDB](https://developer.mozilla.org/docs/Web/API/IndexedDB_API) earns its complexity for blobs
(cached audio, downloaded utterances) and structured app
state (timings JSON per document, bookmarks). The home page
needs neither.

### System framing

#### "Walk me through the architecture from server to highlight."
Bottom up. The server would return a JSON document: the prose
plus precomputed timings — where each word starts in the audio,
where each sentence begins and ends. The page would load that on
mount and an [`<audio>`](https://developer.mozilla.org/docs/Web/API/HTMLAudioElement) element would stream the recording.

The runtime would be three loops. First, a `requestAnimationFrame`
loop reading `audio.currentTime` every frame, finding which word
that timestamp belongs to, writing the index into reactive state.
Second, the overlay reading that state — plus the hovered
sentence, plus the passage's bounding rect — and computing
`<rect>` geometry via `Range.getClientRects()` for whatever needs
to be painted. Third, a `ResizeObserver` writing the passage's
dimensions into state whenever layout shifts, so the overlay
re-derives on its own.

User input would come in along two paths. Clicks on the prose go
`caretPositionFromPoint` → character offset → sentence index →
seek. Hardware media keys go through the Media Session API to the
same seek functions.

Persistence would be `localStorage`, written on `pagehide`, read
on the next mount.

Happy to zoom into any of those layers.

#### "If you had to ship in two days, what do you cut?"
The keepers are the things that make it feel like the demo: an
`<audio>` element with [`preservesPitch`](https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/preservesPitch), the rAF +
`findLastIndex` sync loop, the `getClientRects`-into-SVG
highlight, click-to-seek, and the keyboard shortcuts. Take any
one of those away and it stops being the same product.

What I'd defer: the Media Session integration, the aria-live
fallback, bfcache logging, the structured telemetry, the
[service worker](https://developer.mozilla.org/docs/Web/API/Service_Worker_API). Each of those is a follow-up PR — not a
rearchitecture — so the cut is additive rather than painful.

Honestly, though — Media Session is maybe two hours of work and
it's the thing reviewers notice. If "two days" means "ship
Friday," I'd probably put it back in the keep set.

#### "If you had a month, what's the highest-leverage thing you'd add?"
I'd build virtualization for long documents — a window of ±N
sentences rendered, recycled as the highlight advances —
because it unblocks novels and textbooks, the categories where
the accessibility need is sharpest. After that I'd add offline
(cached audio + timings) and the [`Selection`](https://developer.mozilla.org/docs/Web/API/Selection) API for "play this
paragraph." Visualizers and waveform rendering look impressive in
demos but change the daily-use experience very little, so they'd
go last.

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
