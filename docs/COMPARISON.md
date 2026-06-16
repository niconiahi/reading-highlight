# Our three readers vs. Speechify production — pros and cons

A side-by-side audit. For each of our three `/speechify/*` readers, we
compare against the production implementation reverse-engineered in
`docs/SPEECHIFY_ACTUAL_FUNCTIONALITIES.md`. Pair this with `docs/LEARN.md`
§4 for the technique vocabulary.

Production's choice, as a one-liner reminder: **§4.2 `Range.getClientRects()`,
rendered as a single SVG `<path>` per highlight role, with quadratic-curve
rounded corners, inside an `inset: -10px; pointer-events: none` sibling
overlay per `reader-api-block`.**

The comparison is organised concern-by-concern so we can see where each
example wins and where each falls short.

---

## 0. What's the same across all four

To avoid repeating it in each section: every one of these (our three +
production) is built on the same contract:

- `<audio>` for playback.
- `requestAnimationFrame` reading `audio.currentTime` into reactive
  state (we use Svelte `$state`; production uses whatever, but the
  progress bar precision `3.89392%` implies sub-frame updates, ergo
  rAF).
- A binary search `largest index i with timings[i].start ≤ t` for the
  current word index.
- A `(node, offset) → word_index` chain for click-to-seek (the *node*
  layer differs, see §3 below).
- `preservesPitch` + `mozPreservesPitch` for non-chipmunky fast
  playback.
- `scrollBy` with `prefers-reduced-motion`-gated `'smooth' | 'auto'`
  for auto-scroll.
- Window-level keydown shortcuts gated against
  `HTMLInputElement | HTMLTextAreaElement`.

So this comparison is about the *deltas*. The shared spine is correct
across the board.

---

## 1. Highlight rendering primitive

### 1.1 `box-decoration` (LEARN.md §4.1)

Wraps every sentence in a `<span class="sentence">` and every word in a
nested `<span class="word">`. Toggles `.active` and `.current` classes.
Background is `box-decoration-break: clone` + a same-colour `box-shadow`
spread to bridge the line-break gaps:

```css
.sentence.active {
  background-color: var(--highlight-sentence);
  box-shadow: 0 0 0 0.25em var(--highlight-sentence);
}
.word.current {
  background-color: var(--highlight-word);
  box-shadow: 0 0 0 0.1em var(--highlight-word);
}
```

**Pros vs. production**

- **Zero JS for the visual.** No measurement, no observer, no SVG
  builder. Whole highlight is class toggles.
- **Animates for free.** `transition: background-color 120ms` on the
  sentence is one line and works correctly across line breaks.
- **Reflows on resize without re-measurement.** Resize, font-load, zoom
  — CSS layout does the work. Production has to re-measure and
  re-emit the SVG `d`.
- **Smallest diff vs. plain prose.** The accessibility tree is just
  spans, which AT reads as if they weren't there.

**Cons vs. production**

- **One DOM node per word.** For a paused 12-minute document of ~2k
  words that's fine; for a virtualized novel (LEARN.md §10) it's a
  burden production explicitly avoids by keeping its highlight in the
  SVG layer (the per-token spans production *does* have are for
  click-targets, not for the highlight).
- **Pill geometry is fixed by `box-shadow` spread.** You can't draw a
  pill that bleeds outside the inline box, so two consecutive
  highlighted lines have the spread fudge — which works but is
  visibly a fudge at high zoom. Production's outline-from-rects path
  draws a *true* continuous boundary across lines.
- **Hover and active highlights stack on the same span.** That gives
  the cascade exactly two slots (`:hover` and `.active`). Adding a
  third role (e.g. a "playback-paused-here marker" on top of an active
  sentence) means either nesting another span or layering with
  `outline`/`mask`, which gets messy. Production gets three independent
  layers for free because each highlight is its own SVG.
- **Click-to-seek is `onclick` on a span**, which means we forfeit the
  `caretPositionFromPoint` precision: a click in the *gap* between two
  words still seeks to the sentence's first word (the span gets the
  click). Production also keys clicks to per-token spans but each token
  is a span, so the resolution is per-word not per-sentence.

**Net assessment.** Cleanest code, hardest to scale, most opinionated
visual. Closest to what production does *not* do, which makes it
valuable for short docs and for the interview narrative ("here's the
default; here's why you escalate").

### 1.2 `range-rects` (LEARN.md §4.2)

Single unwrapped text node (`<span class="passage-text">{text}</span>`).
A sibling `pill-layer` with `position: absolute; inset: 0;
pointer-events: none;` holds N absolutely-positioned `<div class="pill">`
elements — one per `DOMRect` for each highlight role (hover sentence,
active sentence, current word). `ResizeObserver` re-measures.

**Pros vs. production**

- **Same primitive as production** — `range.getClientRects()` on a clean
  text node. We are already 90% of the way there.
- **CSS transitions on `left/top/width/height` give a "lava lamp"
  effect** between words for free. Production's SVG path uses a hard
  swap; we have a smoother animation than production does (whether
  that's good or bad is a taste call — but it's a delta).
- **Click-to-seek uses `caretPositionFromPoint`** with fallback to
  `caretRangeFromPoint`, which is the standard pattern (LEARN.md §5).
  We confirm the hit node is the text node before mapping. This is
  *more* general than production's "click the token span" approach,
  because it works at any point inside the line, not just inside a
  word's bounding box.

**Cons vs. production**

- **N divs per highlight, gaps between line fragments.** When a
  sentence spans 4 lines we render 4 `<div>`s; the spaces *between*
  consecutive line rects show through as a 1–2 px gap, which reads as
  visually broken at small line-heights. Production solves this by
  drawing one continuous outline instead of independent rects. We
  could solve it the same way; we just don't yet.
- **Rounded corners are uniform.** Every pill rect is
  `border-radius: 8px`, so the *inside* corners between consecutive
  lines look pinched. Production's quadratic-curve joins distinguish
  outer corners (rounded outward) from inner step corners (rounded
  inward), giving the same shape continuously.
- **No `inset: -10px` bleed.** Our `pill-layer` is `inset: 0`, so a
  highlight at the top of the passage clips at the wrapper edge.
  Production pads the overlay 10 px on each side so the pill can sit
  a hair above the first glyph and below the last.
- **Single text node = single block.** Our `.passage-text` is one
  contiguous text node. Production splits the document into N
  `reader-api-block`s, each with its own overlay; we'd have to do the
  same to virtualize.
- **No layering ordering hook.** We render `hover_rects`, then
  `active_rects`, then `word_rects` in template order. Production
  renders each in its own SVG, which composites trivially. Ours is
  fine too, but moving roles relative to one another means reordering
  template blocks rather than reordering registration calls.
- **Animations don't honour `prefers-reduced-motion`.** The
  `transition: left 80ms linear, …` on `.pill` runs unconditionally.
  We gate the *scroll* animation but not the pill transitions. Bug.

**Net assessment.** The closest of the three to production. The gap is
mostly cosmetic: replace the array of divs with one merged SVG path,
add the 10 px bleed, gate pill transitions on reduced motion, and we'd
be visually indistinguishable.

### 1.3 `highlight-api` (LEARN.md §4.3)

Three `Highlight` objects registered into `CSS.highlights` under
`hover-sentence`, `active-sentence`, `current-word`. CSS uses
`::highlight(name) { background-color: ...; }` to paint each. Zero DOM
mutation for the highlight; zero measurement.

**Pros vs. production**

- **Cheapest possible per-tick cost.** Updating the current-word
  highlight is one `CSS.highlights.set('current-word', new
  Highlight(range))` call. No measurement, no `ResizeObserver`, no
  layout reads. Production does a `getClientRects()` + path emission
  on every word change.
- **No new DOM nodes for highlights at all.** Accessibility tree is
  pristine prose. AT and selection both ignore the decoration. Strong
  story for screen readers.
- **Composes natively.** `hover-sentence` painted under
  `active-sentence` painted under `current-word` is just the
  registration order — production has to enforce this with sibling DOM
  order.

**Cons vs. production**

- **Flat rectangles, no rounded corners.** The API only accepts
  text-paint properties — no `border-radius`, no `padding`, no
  `box-shadow`. Production has rounded pills with quadratic-curve
  joins. Our highlight visually does not match.
- **No bleed.** `::highlight()` paints exactly the line-box rect of the
  range; can't extend above/below. Production's `inset: -10px`
  trick is impossible here.
- **Browser support is recent.** Chromium 105+, Safari 17.2+, Firefox
  140+ (gated). Production presumably has a fallback for older
  browsers — ours just doesn't paint. Acceptable for an interview demo,
  not for production.
- **Click-to-seek is sentence-granular, like §4.1.** Same code as
  `range-rects` (`caretPositionFromPoint` → offset → sentence index →
  `first_word_index`). Note that this snaps to the first word of the
  sentence — production presumably snaps to the *clicked word*. We
  could change that with one line; the API supports it.
- **Hover/active management leaks if you remove a highlight without
  clearing.** Our effect returns a cleanup that deletes the named
  highlight, but the third effect (current-word) doesn't conditionally
  guard against empty `ranges`, so a refresh could leave a stale
  `current-word` painted. Minor footgun.

**Net assessment.** Architecturally the cleanest. Visually the
furthest from production. The right answer when the design is happy
with flat rectangles, or as the layer-0 always-on highlight that
production-style SVG pills paint *over*.

---

## 2. Text-node structure and tokenization

A subtle axis that shows up downstream in click-to-seek, virtualization,
and per-token UI.

| Reader | Structure | Click target | Sub-word UI? |
| --- | --- | --- | --- |
| `box-decoration` | nested `sentence > (word | gap)` spans, one per word + one per inter-word gap | the sentence `<span>` (in our impl) | yes — every word is already a node |
| `range-rects` | single contiguous text node inside `<span class="passage-text">` | the wrapper `.passage` div, resolved with caret hit-testing | no — would need to wrap |
| `highlight-api` | same as `range-rects` | same as `range-rects` | no — would need to wrap |
| **production** | per-token `<span class="relative"><span class="…">word</span></span>`, whitespace and words both segmented | the inner token span (`pointer-events-auto`) | yes — every token is already a node, *and* the outer `.relative` is a positioning anchor for per-word popovers |

**The production choice is interesting.** Production has *both*: the
per-token spans (so click-to-seek doesn't need caret hit-testing, per-
word features like define/copy are trivial, and per-word accessibility
attributes are addressable) *and* the SVG overlay highlight (so the
highlight isn't bound to those spans the way §4.1 binds it). It is
literally a hybrid of `box-decoration`'s DOM shape with `range-rects`'s
rendering strategy.

**Our gap.** None of our three combines these. `box-decoration` has the
DOM shape but the wrong rendering primitive; `range-rects` has the right
rendering primitive but no per-token spans; `highlight-api` has neither.
If we wanted to ship one reader, we'd combine `range-rects`'s overlay
strategy with `box-decoration`'s token wrapping — exactly the
production shape.

---

## 3. Click-to-seek precision

| Reader | Mechanism | Resolution | Gotchas |
| --- | --- | --- | --- |
| `box-decoration` | `onclick` on the sentence span, seek to `sentences[s].first_word_index` | sentence | clicking the gap between two words inside a sentence still snaps to sentence start, not the nearest word |
| `range-rects` | `caretPositionFromPoint` → text-node offset → sentence index → `first_word_index` | sentence (by our own code), could be word | snap-to-sentence is a choice, not a limit |
| `highlight-api` | identical to `range-rects` | same | same |
| **production** | `event.target.closest('span.relative')` → word index from a stored attribute / array index | word | doesn't need caret hit-testing because every token is a node |

**Pros of production's approach**

- No `caretPositionFromPoint` cross-browser feature-detection.
- No "is the hit node my text node?" sanity check.
- Per-word precision falls out for free.
- Per-word *handlers* (mouseenter for word popover, contextmenu for
  define) trivial to attach.

**Cons of production's approach**

- More DOM nodes. Per-token wrapping costs.
- Hit target shape is the *glyph box*, not the line-height box. A click
  in the leading or trailing of a line might miss the word's hit area
  and fall on the parent paragraph instead, which then needs its own
  handler. (Caret hit-testing doesn't have this problem — it always
  resolves to a text offset.)

**Our gap.** `range-rects` is the closest to production-grade. Easy
upgrade: snap to *the clicked word*, not the sentence's first word.
Current code in `on_passage_click` discards the resolved word offset and
uses `sentences[s_idx].first_word_index` instead — a one-line fix.

---

## 4. Block/document structure

| Reader | Block layout | Virtualization-ready? |
| --- | --- | --- |
| `box-decoration` | normal flow, `<article>` with `<h1>`, `<p>`, etc. | no — flow re-layouts on any insert |
| `range-rects` | normal flow + a single `.passage-wrap` for the highlighted region | no |
| `highlight-api` | normal flow | no |
| **production** | `<section style="height: 6636.22px">` with N `reader-api-block`s, each `position: absolute; top: <precomputed>; contain: layout style;` | **yes**, structurally — explicit total height, absolute children, CSS containment |

**Production's structural choice is the single biggest architectural
delta.** Their reader is structurally a virtualizer/recycler whether or
not the current doc is long enough to need recycling. The cost is
upfront — every block's `top` is precomputed, the section's `height` is
precomputed, every block carries `contain: layout style`. The benefit
is that they can recycle blocks, hide off-screen ones, and re-measure
one block without affecting any other.

**Pros of production**

- Inserting / hiding / re-measuring any block is O(1) — no neighbours
  shift, no scroll anchor jitter.
- `contain` lets the browser skip layout/paint of off-screen blocks.
- `overflow-anchor: none` on the section keeps scroll under app
  control.
- Per-block overlays (the SVG highlight layer) compose cleanly because
  each block owns its own positioning context.

**Cons of production**

- Total height has to be recomputed if any block resizes (font load,
  responsive image, dynamic content). They must have a measurement
  pipeline.
- More upfront complexity. For a short doc, this is overkill.

**Our gap.** None of our three has this. We render flat HTML and let
flow do the layout. That's fine for the example docs; it's the wrong
shape for a "ship this to production" answer. The fix is the same
across all three of ours: wrap each markdown block in a measured
container, compute heights once, render with `position: absolute`.

---

## 5. Layered highlights (hover / active / word)

| Reader | Mechanism | Layer ordering | Hover layer present? |
| --- | --- | --- | --- |
| `box-decoration` | nested spans + class toggles | DOM nesting → cascade | hover via `:hover` (no JS) |
| `range-rects` | three groups of `<div>`s in the pill layer | template order | yes — `hovered_sentence_index` drives JS-tracked rects |
| `highlight-api` | three named `Highlight`s in the registry | registration order | yes, same JS tracking |
| **production** | three sibling SVG overlays per block | DOM order | yes — the empty-SVG sibling between yellow and blue is the most likely hover slot, currently unpopulated |

**Pros and cons line up like this:**

- **`box-decoration` wins on hover specifically.** `:hover` is pure CSS;
  it's instant and doesn't burn rAF. The others all listen for
  `mousemove`, caret-hit-test on every move, derive the sentence index,
  and re-measure or re-set the highlight. That's hundreds of operations
  per second during mouse motion across prose. We get away with it
  because the work is cheap, but it's measurably worse than
  `:hover`.
- **Production accepts the `mousemove` cost because §4.1 isn't
  available** — they wrap every token, not every sentence, so there's
  no convenient sentence span for `:hover` to live on. They could add
  sentence-grouping spans, but that complicates the token-level
  features.
- **The Highlight API's composition story is the cleanest.**
  Registration order *is* layer order; one line of code per layer.
  Production has to reason about DOM sibling order to get the same
  result. For the right design, this would be a clear architectural
  win.

---

## 6. Accessibility delta

All four have `aria-live` only for app-level events (we use it for
play/pause indirectly via state changes; production uses a literal
`<div aria-live="polite" class="sr-only">Paused</div>`). All four
respect (or should respect) `prefers-reduced-motion`.

The differences:

- **`box-decoration` adds `tabindex="0"` and `role="button"` to every
  sentence span.** LEARN.md §9 explicitly argues against this — it
  puts a tab stop on prose with nothing meaningful to do once focused.
  We did it to support keyboard "play sentence on Enter," but that's
  better served by arrow-key navigation through a focused passage,
  with the sentence boundary derived rather than the focus moving.
  Production does *not* put tab stops on prose. We should reconsider.
- **`range-rects` and `highlight-api` put `role="button"` and
  `tabindex="0"` on the whole `.passage` div.** One tab stop for the
  whole prose, not N. Less wrong than `box-decoration`, but still
  doesn't match production, which puts no role on prose at all.
- **All three of ours render a `<span class="sr-only" aria-live=
  "polite">` that mirrors the current word.** This is the very thing
  LEARN.md §9 warns against — double-speak with the TTS voice.
  Production does not do this. We should remove ours.

**Net.** All three of our examples carry one or two AT bugs that the
production reader avoids. Easy fixes; worth doing before the interview.

---

## 7. Performance per frame

Rough per-frame cost during normal playback (current word advancing,
no hover, no resize):

| Reader | DOM writes | Layout reads | Measurement |
| --- | --- | --- | --- |
| `box-decoration` | one class toggle (`.current` from word N to word N+1) | 0 | 0 |
| `range-rects` | re-create 1–3 `<div>`s for the word rect | 1 (`getBoundingClientRect` on `pill_layer` inside `rects_for`) | 1 (`range.getClientRects()`) |
| `highlight-api` | 1 `CSS.highlights.set` | 0 | 0 |
| **production** | replace 1 `<path d="…">` attribute | 1 (overlay's bounding rect, implicit) | 1 (`range.getClientRects()`) |

**Pros**

- **`highlight-api` is the cheapest.** Same cost as production for
  hover, lower cost for word advance.
- **`box-decoration` is essentially free** during steady playback.
- **`range-rects` and production are roughly equivalent.** A `path d`
  swap is a single attribute write the renderer can fast-path;
  creating/removing `<div>`s is also fast at this scale. The
  measurement is the dominant cost in both.

**Cons**

- **`range-rects` triggers a transition on every word advance.** That's
  intentional (the lava-lamp animation) but it forces composited
  property animations on `top/left/width/height`, which costs more than
  the `path d` swap production does. If perf matters more than the
  animation, ours is more expensive than production's.

**Net.** No reader is in performance trouble at the scale these examples
hit. The numbers matter at virtualization scale (LEARN.md §10), which is
also where production's architecture (the §4 block layer + §1 SVG
overlay) pays off.

---

## 8. Theming / customisation

| Reader | Colour source | Multi-colour roles | Light/dark |
| --- | --- | --- | --- |
| `box-decoration` | `var(--highlight-sentence)` etc., used in `background-color` and `box-shadow` | 3 (sentence, sentence-hover, word) | works via CSS variable swap |
| `range-rects` | same custom-prop names, used in `background-color` of `.pill` variants | 3, but unable to layer beyond | works via swap |
| `highlight-api` | `::highlight(name) { background-color: var(--…); }` | 3, composed by registration order | works via swap |
| **production** | `fill: var(--color-hglt-sec | -prim)` on each SVG; full token-level themes via `--color-*` namespace | observed 2 layers + 1 empty slot, likely 3 | full design system, `dark:` class on `<html>` |

Production has a much richer design-system surface — CSS custom
properties are namespaced by role (`bg`, `icn-txt`, `brdr`, `sf-prim`,
`hglt`) and scaled (`w-110`, `w-90`, `w-70`, `w-b`). We use a flat
handful. For a 1:1 production match we'd need a much bigger token
inventory; for an interview demo, ours is fine.

---

## 9. What we'd build if we had to ship one reader

The conclusion of the comparison is that **none of our three is
production-shaped, but `range-rects` is the closest, and the gap is
mechanical, not conceptual.**

Concrete upgrade path:

1. **Adopt production's hybrid structure.** Keep `range-rects`'s
   overlay-driven highlight. Add `box-decoration`'s per-token
   wrapping for click targets and per-word UI hooks. Highlights stay
   in the SVG; clicks come off the token spans.
2. **Replace N pill `<div>`s with one merged SVG `<path>`.** Algorithm
   described in `SPEECHIFY_ACTUAL_FUNCTIONALITIES.md` §9. Quadratic
   joins, `inset: -10px` bleed, viewBox shifted accordingly.
3. **Per-block overlays.** Split the document into measured blocks,
   one overlay per block, `contain: layout style` on each. This is
   the structural shift that unlocks both virtualization and
   per-block highlight isolation.
4. **Drop the `aria-live` word mirror.** LEARN.md §9 violation; we
   added it defensively but production didn't, and the reasoning is
   solid (double-speak with TTS).
5. **Drop the `tabindex="0"` + `role="button"` on prose.** Same
   reasoning. Keep keyboard nav at the window level (Space,
   ArrowLeft/Right).
6. **Gate pill transitions on `prefers-reduced-motion`.** Current
   `range-rects` only gates the scroll; the pill animation runs
   unconditionally.
7. **Keep `highlight-api` as a fallback layer for browsers without
   SVG/measurement budget, or as the "always paint flat" layer that
   the rounded SVG renders over.** Production presumably has a
   fallback strategy; this is the cleanest one we'd build.

The result is exactly what production runs. Each of our three
examples contributed something to it: `box-decoration` contributed the
DOM shape, `range-rects` contributed the rendering primitive,
`highlight-api` contributed the layer-composition idea.

---

## 10. One-table summary

| Concern | `box-decoration` | `range-rects` | `highlight-api` | **production** |
| --- | --- | --- | --- | --- |
| Highlight primitive | inline span background | absolute `<div>` per `DOMRect` | named `Highlight` on a `Range` | absolute SVG `<path>` from `getClientRects()` |
| Rounded corners | ✅ via `border-radius` | ✅ uniform | ❌ flat | ✅ contextual (outer vs inner) |
| Continuous across lines | fudged with `box-shadow` | gaps between line rects | line-box only | ✅ true outline |
| Per-tick cost | one class toggle | re-create 1–3 divs | one `CSS.highlights.set` | one `d` attribute swap |
| Measurement | 0 | 1 `getClientRects` | 0 | 1 `getClientRects` |
| Click-to-seek granularity | sentence | sentence (could be word) | sentence (could be word) | word |
| Click target | sentence span | wrapper + caret hit-test | wrapper + caret hit-test | token span |
| Sub-word UI hooks (popover, define) | yes (word span) | no | no | yes |
| Hover layer | `:hover` (free) | JS-tracked | JS-tracked | JS-tracked (slot reserved) |
| Sub-range across boundaries | ❌ | ✅ | ✅ | ✅ |
| Virtualization-ready | ❌ | ❌ | ❌ | ✅ |
| Block isolation | ❌ | ❌ | ❌ | ✅ (per-block overlays + `contain`) |
| `inset: -10px` bleed | n/a (inline) | ❌ | n/a (line-box) | ✅ |
| Reduced motion compliance | ✅ scroll only | ⚠️ scroll only, pill anim unconditional | ✅ scroll only | presumed ✅ |
| `aria-live` per word (anti-pattern) | ⚠️ present | ⚠️ present | ⚠️ present | ❌ absent (correct) |
| Tab stops on prose | ⚠️ per sentence | ⚠️ one for whole passage | ⚠️ one for whole passage | ❌ none (correct) |
| Browser support | universal | universal | Chromium 105+ / Safari 17.2+ / Firefox 140+ | universal (presumed) |

Legend: ✅ matches production / correct, ⚠️ works but with a known
issue, ❌ missing or wrong.
