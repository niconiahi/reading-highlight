# Building Speechify's reading surface — production-aligned subset

This is `LEARN.md` filtered down to *only the techniques production
actually ships*, as observed in
`docs/SPEECHIFY_ACTUAL_FUNCTIONALITIES.md` (paused-reader snapshot from
`app.speechify.com/item/<uuid>`, 2026-06-15). The full `LEARN.md`
surveys the design space — three highlight techniques, Web Speech,
`FileReader`, the whole vocabulary. This file is the narrower cut: what
the live product is actually doing, and the one route in this repo
(`/speechify/range-rects`) that knowingly deviates from it.

Everything dropped from `LEARN.md` was dropped because the snapshot
shows production doesn't use it. `box-decoration-break: clone` is not in
production — gone. The CSS Custom Highlight API is not in production —
gone. The Web Speech API is the section `LEARN.md` writes specifically
to argue *against* — gone. File ingestion via drag-and-drop isn't on
the reader page — gone. What remains is the production pipeline.

The contrast at `/speechify/range-rects` is called out in §4: production
wraps every token in nested spans for cheap hit-testing; our local route
keeps the prose unwrapped to score higher on semantic HTML, and pays for
that choice with `caretPositionFromPoint`. Both approaches use the same
underlying primitive (`Range.getClientRects()` rendered as one SVG
path), so the contrast is purely about the prose markup around it.

---

## 0. The contract

Same contract as `LEARN.md` §0, unchanged in production:

- a **text** string,
- a list of **word ranges** — `[char_start, char_end]` per word,
- a list of **word timings** — `{ start, end }` in seconds per word,
- a list of **sentence spans** stitched on top — `{ start, end,
  first_word_index, last_word_index }`.

Everything else is one of *time → word index*, *word index → character
range*, *character range → geometry*, or *click → character range → word
index → time*.

---

## 1. Audio playback — `<audio>`, not Web Audio

Production uses `HTMLAudioElement`. The player widget exposes the
behaviours that tie to its properties one-to-one:

- **`player-play-button`** → toggles `audio.paused`. The button's
  container carries `<div aria-live="polite" class="sr-only">Paused</div>`
  — a live region for the *app-level* play/pause state, never for the
  per-word stream. (`LEARN.md` §1 / §9 prediction confirmed.)
- **`player-backward-button` / `player-forward-button`** → `aria-label
  ="Skip back 10 seconds"`, bound to `audio.currentTime ±= 10`.
- **`player-speed-button`** showing `1×` → drives `audio.playbackRate`.
  The Speechify product range is 0.5×–4.5×, and `preservesPitch` has to
  be `true` (plus the `mozPreservesPitch` legacy alias) or the voice
  goes chipmunky and a dyslexic 1.5× listener loses the product.
- **`player-voice-button`** with `data-voice-name="Samantha"` and a
  country-flag image → swaps the audio source.
- **Progress bar** `role="progressbar"` with `style="width: 3.89392%;"`
  on its inner div — high-precision percent, consistent with a
  per-frame update.

What production does *not* use: the Web Speech API (`SpeechSynthesis`).
The product *is* the branded voice — OS voices defeat it — and Web
Speech can't expose audio for caching, can't be downloaded for offline,
and emits word timings only *as the voice speaks* (so you can't
pre-compute geometry or show a sentence-level highlight in advance).
Server-side TTS that returns `{ audio_url, text, timings }` is the
right primitive; `<audio>` plays it; the highlight is driven from
`currentTime`. (`LEARN.md` §11 — the section exists to dismiss the
alternative, included here because the dismissal still applies.)

Web Audio is also absent from the snapshot. The reader is text-with-
audio, not a waveform/visualizer app; the 50 MB decode-into-PCM cost
for a 30-minute MP3 buys nothing the reader uses.

---

## 2. The time-sync loop — `requestAnimationFrame` + binary search

The snapshot is paused, so the loop itself isn't directly visible, but
the progress bar's `width: 3.89392%` (six significant digits of an
inexact percent) tells you the update frequency is well above what
`timeupdate` could produce on its own — `timeupdate` ships at 4–15 Hz
depending on browser, slower than the word rate of normal speech, so
the highlight would visibly trail the voice if it were the source.

Production runs `requestAnimationFrame`, reads `audio.currentTime` per
frame, copies it into reactive state, and derives the current word
index via a one-sided binary search: **largest index `i` such that
`words[i].start ≤ t`**. The `start ≤ t < end` variant is wrong — it
blinks the highlight off during the silences between words
(punctuation, breath, sentence ends), and there are *always* silences.
The one-sided form keeps the highlight on the most recently started
word across the gaps and makes short words unmissable regardless of
frame timing.

If the highlight feels late, subtract a small constant (60–100 ms) from
`t` before the search. Bias *early* — landing on the next word a hair
before the voice says it reads as "in sync"; landing late reads as
"broken." End-to-end budget: 20–100 ms audio output latency, ~16 ms
rAF granularity at 60 Hz, < 10 ms error on TTS-emitted timings.

`rAF` pauses in background tabs. That's the right default for a reader
— nobody's looking. If you ever need state to keep advancing while
hidden (analytics, server progress), fall back to a slow `setInterval`
on `visibilitychange`.

---

## 3. Tokenization — `Intl.Segmenter`-shaped output, two granularities

The snapshot's token markup gives the source-of-truth away: every word
*and every run of whitespace* is its own `<span class="relative">`,
matching `Intl.Segmenter` at `granularity: 'word'` exactly (ICU emits
whitespace as a separate "word-like" segment with `isWordLike: false`).
A regex `\w+` would not produce that shape, and it would silently
diverge on CJK, Thai, Khmer, Arabic, and contraction apostrophes.

You run `Intl.Segmenter` twice over the same text — once at
`granularity: 'word'`, once at `granularity: 'sentence'` — and stitch:
each sentence carries a `first_word_index` and `last_word_index`.
That's the structure powering both click-to-seek and the sentence-
level highlight layer.

The accessibility reason this matters: OS-level double-click-selects-
word uses the same ICU rules. A user who triple-clicks a sentence and
asks their screen reader to spell-check, copy, or look up a word gets
the same boundary you used to draw the highlight. Regex divergence
breaks that invariant silently — no error, worse experience.

---

## 4. Highlight rendering — `Range.getClientRects()` as one SVG path

Production uses `LEARN.md` §4.2 — `Range.getClientRects()` measuring a
sub-range against the underlying text — but renders the result as a
**single SVG `<path>` per highlight, not as N absolutely-positioned
`<div>` pills.** Same primitive, fancier renderer.

How we know it's §4.2 and not the other two:

- **Not §4.1 (`box-decoration-break: clone`).** That technique requires
  the highlighted region to be a single inline element. Production
  wraps each token in its own `<span class="relative">` (for per-word
  click/hover), and the highlight is applied as a sibling overlay, not
  as a background on those spans. §4.1 cannot draw a highlight that
  spans across N independent inline spans without a parent inline
  wrapping them — and there is no such parent.
- **Not §4.3 (CSS Custom Highlight API).** `::highlight()` only accepts
  text-paint properties — `color`, `background-color`, `text-decoration*`,
  `text-shadow`, `-webkit-text-stroke-*`. No `border-radius`, no
  rounded shapes. The production pills have visibly rounded corners
  (the SVG `d` uses `Q` quadratic-curve commands at every corner).
- **Is §4.2.** Geometry comes from measurement (the `d` is numeric,
  per-line, changes with layout). The overlay is a sibling with
  `pointer-events: none`. The text node is untouched.

### The overlay markup

```html
<div class="whitespace-pre-wrap flex flex-col reader-api-block"
     style="padding-top: 10px; padding-bottom: 10px;">

  <!-- highlight layer 1: sentence/passage (yellow) -->
  <div class="absolute pointer-events-none" style="inset: -10px;">
    <svg width="639.16" height="366.96" viewBox="-10 -10 639.16 366.96"
         style="fill: var(--color-hglt-sec);">
      <path d="M 20.89,346.97 Q 11.89,346.97,11.89,337.97 … Z"/>
    </svg>
  </div>

  <!-- highlight layer 2: current word (blue) -->
  <div class="absolute pointer-events-none" style="inset: -10px;">
    <svg width="384.93" height="310.80" viewBox="-10 -10 384.93 310.80"
         style="fill: var(--color-hglt-prim);">
      <path d="M 341.3,290.81 Q … Z"/>
    </svg>
  </div>

  <p>
    <span class="relative"><span class="no-selection-color pointer-events-auto"
      style="font-size: 18px; --font-size: 18px;">The</span></span>
    <span class="relative"><span class="…">…</span></span>
    …
  </p>
</div>
```

Things to call out:

- **`inset: -10px` bleed.** The overlay extends 10 px past each side of
  the block so a pill can stick out past the paragraph's
  `padding-top: 10px; padding-bottom: 10px;` without being clipped.
- **`viewBox="-10 -10 W H"`.** The SVG coordinate system is shifted by
  `(-10, -10)` so path values can be expressed in block-local pixel
  coordinates — the same numbers `getClientRects()` returns, minus the
  block's bounding rect. No post-measurement arithmetic.
- **Path is one continuous outline, not N rects.** Trace the numbers:
  it starts at the bottom-left of one line rect, climbs up, jogs
  horizontally to the next line's width, climbs again, etc. — drawing
  the union of all per-line `DOMRect`s as one shape, with rounded joins
  between lines. This is production's answer to the same problem the
  `box-shadow` spread trick solves for §4.1: consecutive line fragments
  read as one continuous pill rather than three disjoint ones.
- **Two layers, sibling SVGs.** Yellow sentence layer (`639 × 367`),
  blue word layer (`385 × 311`). Each SVG is sized to its own outline.
  They composite in DOM order with no z-fighting because they're
  `position: absolute` siblings painting behind the in-flow prose.
- **`aria-hidden` on the overlay implied.** The highlight is decoration;
  the audio is the announcement. AT skips it.

### Per-token markup

```html
<span class="relative">
  <span class="classic-text-responsive no-selection-color pointer-events-auto"
        style="font-size: 18px; --font-size: 18px;">word</span>
</span>
```

- **Outer `<span class="relative">`** is a positioning anchor for
  per-word UI (hover popovers, define-this-word, copy).
- **Inner span carries `pointer-events-auto`.** The overlay has
  `pointer-events: none`, so clicks land on the token — the right
  target for click-to-seek.
- **`no-selection-color`** suppresses the OS `::selection` background
  so it doesn't double up with the reader's own highlight when a user
  drags a selection across an already-highlighted region.
- **Whitespace as its own token.** Matches `Intl.Segmenter`'s
  `isWordLike: false` whitespace segments, and makes click hit-testing
  a plain `event.target.closest('span.relative')` lookup with no offset
  arithmetic across text nodes.

### The route that knowingly deviates: `/speechify/range-rects`

**This is the important contrast.** Open
`http://localhost:5173/speechify/range-rects`. It implements the same
highlight technique production uses (`Range.getClientRects()` rendered
as one outline SVG path per role — see
`src/routes/speechify/range-rects/+page.svelte` for `path_hover`,
`path_active`, `path_word`). What it does *not* do is wrap every token
in its own pair of spans. The prose is a single text node inside a
single `<span class="passage-text">{text}</span>` inside a real `<p>`
inside a real `<article>`. That is intentional, and it is the only
deliberate divergence from production in this repo.

The trade-off, stated bluntly:

| Concern                                  | Production                                                                                       | `/speechify/range-rects` (local)                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Prose markup                             | every word + every whitespace run wrapped in `<span class="relative"><span>…</span></span>`      | a single text node inside one `<span class="passage-text">`, inside a real `<p>` inside `<article>` |
| Semantic HTML score (`LEARN.md` §4.2)    | ~5/10 — paragraph turns into hundreds of `<span>`s; the prose meaning is buried in markup soup    | 9/10 — `<article><p>…</p></article>` is exactly what you wrote                              |
| Click-to-seek hit-testing                | `event.target.closest('span.relative')` → token element → stored word index. Cheap, no caret math | `document.caretPositionFromPoint(x, y)` (with `caretRangeFromPoint` fallback) → `(node, offset)` → character index → binary-search word ranges |
| Per-word UI (define-word, copy, hover popovers) | trivially anchored to the per-token outer span                                              | needs measurement against the text node — harder to position popovers per-word            |
| DOM weight for a 400-page novel         | ~hundreds of thousands of spans, with the markup costs that implies (DOM size, AT churn on class toggles, copy-paste artefacts on some browsers) | the prose stays the prose; the only DOM cost is the sibling overlay layer                  |

The production tradeoff makes sense for them: at the price of markup
density, they get cheap word-level interactions, and they need
word-level interactions because the reader has per-word hover
popovers, define-word, and so on. Their virtualizer (see §7 below)
mitigates the DOM-weight cost — only the visible window of blocks is
materialised at any moment.

The `/speechify/range-rects` tradeoff makes sense for *this repo*: the
point of the route is to demonstrate `Range.getClientRects()` rendered
into a clean DOM, where the only nodes that exist are the ones that
mean something. Semantic HTML survives — reader-mode extractors, RSS
pipelines, search crawlers, screen readers, and your future self
reading the markup all see `<article><p>The quick brown fox…</p></article>`,
not a span soup. The cost is `caretPositionFromPoint` doing more work
than `closest()` per click; for an interview / reference example, that
is the right side of the trade.

**Both** approaches share the actual highlight renderer: one outline
SVG path per role, drawn from `getClientRects()`, in a sibling
`pointer-events: none` overlay with `inset: -10px` bleed and
`viewBox="-10 -10 W H"`. The contrast is only about the prose markup
around it.

### Costs §4.2 imposes (production pays them too)

You must re-measure on resize, on font load, on any content change.
`ResizeObserver` on the wrapping element catches resize and most
font-load shifts in one go — it fires on internal layout shifts, not
just viewport changes. Pair with a `resize` listener only if you care
about viewport shifts that don't affect the observed element (rare).

`getClientRects()` returns viewport-relative coordinates. You subtract
the bounding rect of your positioned ancestor to draw into the
overlay's local coordinate system. The `viewBox="-10 -10 W H"` shift
folds the 10 px bleed into the same calculation.

---

## 5. Click-to-seek and selection

A reader where you can't click a word to start reading from it is a
worse reader. Speechify ships this — it lets a user with fatigue,
distraction, or a screen-reader interruption resume from where their
attention broke.

Two implementations live in the codebase, matching the §4 contrast:

- **Production / per-token-spans path.** `event.target.closest('span.relative')`
  gives you the token element. The token's stored word index — likely
  on a `data-` attribute or via an external index map — feeds
  `audio.currentTime = timings[i].start`. No caret math. Cheap.
- **Unwrapped-prose path (`/speechify/range-rects`).**
  `document.caretPositionFromPoint(x, y)` returns `{ offsetNode, offset }`.
  Feature-detect; fall back to `document.caretRangeFromPoint(x, y)`
  for older WebKit / Chromium spellings. Confirm the hit node *is*
  the passage's text node (otherwise the click hit decoration, not
  prose), turn the offset into a character index, binary-search the
  word ranges, seek.

After either path, the rAF loop picks up the new `currentTime` on the
next frame and the highlight catches up.

### Selection — play-selection

The scrollport carries `user-select: text` explicitly (everything else
in the chrome is `user-select: none`). Inside the reader, prose is
selectable. The Selection API does the rest: listen for
`selectionchange`, read `document.getSelection().getRangeAt(0)`, map
the range's start to a word index, offer a "play selection"
affordance. Same `(node, offset) → word index` plumbing as
click-to-seek.

### Keyboard

The top nav exposes the production keyboard shortcuts:

- `aria-label="Find text (⌘+F)"` on the search button — overrides the
  browser's built-in find (necessary because the prose is virtualized
  and the browser would miss off-screen blocks).
- `aria-label="Add bookmark (⌘+B)"` on the bookmark button.

Wire those at the `window` level with a `target instanceof
HTMLInputElement || target instanceof HTMLTextAreaElement` guard so
they don't steal keystrokes from form fields. `e.code` (physical key,
layout-independent) for positional shortcuts like Space and the
arrows; `e.key` when the meaning *is* the printed character (`/`, `b`).

---

## 6. Keeping the highlight on screen

Auto-scroll lives on `data-reader-scroll-container="true"`
(`overflow-y-auto`), not on `window`. Two production tells make the
implementation predictable:

- **`overflow-anchor: none`** appears twice — on the scroll container
  *and* on the `<section>` that holds the virtualized blocks. Chrome's
  scroll anchoring would silently adjust `scrollTop` when content
  above the viewport mutates; for a reader that's controlling scroll
  itself, that's a fight. Disabling it is the production tell that
  scroll is app-managed.
- **The padding tells you the margins.** `padding-top: 61px` clears
  the 53 px top nav (plus an 8 px gap); `padding-bottom: 136px`
  clears the 128 px floating player (plus an 8 px gap). Anything
  inside the padding is visually under the nav or under the player.
  Auto-scroll's keep-on-screen margins have to be at least these
  numbers, plus a comfortable buffer (the `LEARN.md` §6 sketch uses
  40 px top / 140 px buffer above the chrome).

The pattern:

1. After the highlight position updates, measure its rect.
2. Measure the scroll container's rect.
3. If the highlight is within the comfortable margin, do nothing.
4. Otherwise, `scrollBy` an amount that re-centres it, with
   `behavior: 'smooth'` (or `'auto'` under `prefers-reduced-motion`).

`scrollIntoView({ block: 'nearest' })` is the wrong tool because it
only triggers once the element has half-left the viewport, which feels
late. The margin trick fires the gentle scroll *before* the edge.

And: don't fight the user. If they've manually scrolled away to
re-read something, aggressively re-centring is the opposite of
helpful. Suppress auto-scroll during user interaction; resume after N
seconds of idle.

---

## 7. Virtualization — `reader-api-block` for every document

Every top-level block (heading, paragraph, list, code block) is a
`reader-api-block` with `position: absolute` and a precomputed `top`
inside a sized `<section>` parent:

```html
<section style="contain: size style paint; overflow-anchor: none;
                overflow: clip; flex: 0 0 auto; position: relative;
                width: 100%; height: 6636.22px;">
  <div style="contain: layout style; position: absolute; width: 100%;
              left: 0px; top: 0px; visibility: visible;">
    <div class="reader-api-block">…heading…</div>
  </div>
  <div style="contain: layout style; position: absolute; width: 100%;
              left: 0px; top: 163.52px; visibility: visible;">
    <div class="reader-api-block">…paragraph…</div>
  </div>
  …
</section>
```

This is the `LEARN.md` §10 virtualizer, applied to *all* documents (not
just long ones). What it gives:

- **`section` height is the precomputed sum.** `6636.22px` here — the
  scroll height for the document. The browser doesn't layout-flow N
  blocks to compute it; it's pinned.
- **Each block is `position: absolute`** at a precomputed `top`. No
  block contributes to the section's height through flow. Inserting,
  removing, or re-measuring a block doesn't shift its neighbours'
  `top` values — they're independent. Per-block re-measurement stays
  cheap and predictable.
- **CSS containment.** `contain: layout style` on every block;
  `contain: size style paint` on the section. A hard promise to the
  browser that layout/paint inside the container can't affect anything
  outside it. Without that promise, the virtualizer's optimisations
  don't kick in.
- **`visibility: visible`** is explicit on each wrapper. Off-screen
  blocks (not in this snapshot, inferable from the pattern) likely
  flip to `visibility: hidden` to skip painting while keeping layout
  bounds, or detach entirely if the recycler decides the window is too
  far away. The precomputed `top` means re-attaching doesn't shift
  anything.

The implication for §4 stands: the per-token span density only costs
what's *currently materialised*, not the whole 400-page novel.
Virtualization is what makes production's high-density per-token
markup affordable.

---

## 8. Persistence

Out of scope for what the snapshot can show — no way to observe
`localStorage` / `IndexedDB` writes from rendered HTML. But the
contract from `LEARN.md` §7 is the right shape:

- **`localStorage`** for small synchronous state (last position, voice
  choice, playback rate). Strings only, ~5–10 MB cap, blocks the main
  thread. Write on `pause` and `pagehide`, not every tick. Debounce
  if you must write more often.
- **`IndexedDB`** for binary and large structured data (cached audio
  blobs, timings JSON, downloaded utterances). Gigabyte-scale, async,
  ugly raw API; a thin promise wrapper pays for itself.

Offline goes through a Service Worker that intercepts audio requests
and serves from the Cache API (whole HTTP responses, headers preserved,
range requests honoured — necessary because `<audio>` issues range
requests for seeking) or from IndexedDB for blobs the app explicitly
downloaded.

Resuming where the user left off is itself accessibility — for the
dyslexic reader the product was built for, "refinding my place in a
400-page book" can be the entire failure mode.

---

## 9. Accessibility, end-to-end

Speechify is a literal accessibility product. The audio is the
apology for text being hostile to a non-trivial fraction of readers.
The patterns the snapshot confirms:

- **The audio is the announcement.** `aria-live` exists in the player
  (`<div aria-live="polite" class="sr-only">Paused</div>`) but only
  for app-level events. Per-word text is *never* wired into a live
  region — that would make a screen reader read each word twice (once
  via the TTS voice, once via the reader's own voice, on a delay).
- **No `tabindex` on decorative prose.** The token spans are click
  targets via `pointer-events-auto`, not tab stops. Forcing a tab stop
  onto prose so the keyboard user can trigger a visual pill gives them
  a stop with nothing to do.
- **`tabindex="-1"`** on the scroll container — programmatically
  focusable for keyboard shortcuts that need a focused container, not
  in the tab order.
- **Verbose `aria-label`s on opaque controls.** `aria-label="Listened:
  29 seconds, switch to percentage"` while the visible text is `0:29`.
  The visible text is for sighted users; the label is the announce-
  friendly version.
- **`Intl.Segmenter` for word boundaries.** Same ICU rules as
  OS-level double-click-selects-word, so AT and the highlight agree on
  what a word is.
- **`user-select: text`** explicit on the scroll container, so
  Selection API drives "play selection" — and `user-select: none`
  everywhere on the chrome so accidental drags on buttons don't
  produce text selections.

Things `LEARN.md` calls for that the snapshot can't confirm:

- **`prefers-reduced-motion`** on auto-scroll, the lottie button
  animations, any pill-morph between sentences. Long reader sessions
  and vestibular sensitivity are a bad pairing. Worth checking by
  toggling the OS-level setting.
- **`:focus-visible`** to keep outlines off mouse clicks but on
  keyboard navigation.
- **Visually-hidden, not display-none.** `display: none` and
  `visibility: hidden` remove from the accessibility tree; the clipped
  1px-box "sr-only" pattern keeps content in the AT tree (the `Paused`
  live region uses it).

---

## 10. Performance

Three things the snapshot validates:

- **Virtualize all documents, not just long ones.** §7. The
  `reader-api-block` recycler with `contain: layout style` and a
  pinned `<section>` height is what makes the per-token span density
  affordable. Render a window of ±N sentences around the current
  position; recycle nodes as the highlight advances.
- **Don't read-then-write.** Batch all your `getBoundingClientRect` /
  `offsetTop` reads, then batch all your style writes. Interleaving
  forces synchronous layout per element ("layout thrashing"). The
  danger spot in a reader is the auto-scroll effect — measure the
  highlight and scroll container *first*, decide, then write the
  scroll.
- **`will-change` sparingly.** It promotes the element to its own
  compositor layer (dodges repaints during animation) but costs GPU
  memory. Add at animation-start, remove at animation-end. Don't
  blanket-apply.

---

## 11. CSS custom-property design system

The reader uses a CSS-custom-property design system; the relevant
slots for the techniques above:

- **Highlight colours**: `--color-hglt-sec` (sentence), `--color-hglt-prim`
  (current word). Two slots, used by the two SVG fills. Filling via
  custom property lets the same SVG mark be reused across themes —
  light, dark, and any future variants. (`<html class="font-app dark"
  data-platform="macos">` shows dark mode is the active scheme in the
  snapshot.)
- **Per-token type scale**: `--font-size: 18px` mirrored alongside the
  inline `style="font-size: 18px"`. A `classic-text-responsive`
  utility reads `var(--font-size)` and clamps/scales it. Setting both
  means the inline value is the unscaled baseline and the custom
  property is what the cascade actually paints. Reasonable defensive
  pattern for a user-resizable reader.

---

## 12. Reference index

- HTMLAudioElement — https://developer.mozilla.org/docs/Web/API/HTMLAudioElement
- HTMLMediaElement.playbackRate — https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/playbackRate
- HTMLMediaElement.preservesPitch — https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/preservesPitch
- requestAnimationFrame — https://developer.mozilla.org/docs/Web/API/Window/requestAnimationFrame
- Range — https://developer.mozilla.org/docs/Web/API/Range
- Range.getClientRects — https://developer.mozilla.org/docs/Web/API/Range/getClientRects
- ResizeObserver — https://developer.mozilla.org/docs/Web/API/ResizeObserver
- scrollBy — https://developer.mozilla.org/docs/Web/API/Element/scrollBy
- caretPositionFromPoint — https://developer.mozilla.org/docs/Web/API/Document/caretPositionFromPoint
- caretRangeFromPoint — https://developer.mozilla.org/docs/Web/API/Document/caretRangeFromPoint
- Selection API — https://developer.mozilla.org/docs/Web/API/Selection
- Intl.Segmenter — https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter
- IndexedDB — https://developer.mozilla.org/docs/Web/API/IndexedDB_API
- Cache API — https://developer.mozilla.org/docs/Web/API/Cache
- Service Worker — https://developer.mozilla.org/docs/Web/API/Service_Worker_API
- CSS containment — https://developer.mozilla.org/docs/Web/CSS/CSS_containment
- overflow-anchor — https://developer.mozilla.org/docs/Web/CSS/overflow-anchor
- prefers-reduced-motion — https://developer.mozilla.org/docs/Web/CSS/@media/prefers-reduced-motion
- aria-live — https://developer.mozilla.org/docs/Web/Accessibility/ARIA/Attributes/aria-live
- :focus-visible — https://developer.mozilla.org/docs/Web/CSS/:focus-visible
