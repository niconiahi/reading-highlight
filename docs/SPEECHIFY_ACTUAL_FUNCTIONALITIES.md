# Speechify production reader — observed implementation

Reverse-engineered from a live Speechify reader page (the `/item/<uuid>`
route, app.speechify.com, 2026-06-15). The snapshot was the rendered HTML
of a paused reader showing a markdown document, with one sentence-level
highlight and one word-level highlight visible. Pair this with
`docs/LEARN.md` §4 — the techniques catalogued there are the vocabulary
this doc uses.

The point of this file: when we sit down later to copy or improve any of
the techniques in `/speechify/*`, this is what production actually
shipped, so we can match it or knowingly deviate.

---

## 1. Highlight rendering — the headline finding

**Speechify uses `Range.getClientRects()` (LEARN.md §4.2), but renders
the result as a single SVG `<path>` per highlight, not as N
absolutely-positioned `<div>` pills.**

This is the most interesting deviation from our three reference examples.
Our `/speechify/range-rects` example draws one `<div>` per `DOMRect`.
Production stitches the rects into one rounded outline and draws it as a
single SVG path. Same primitive, fancier renderer.

### How we know it's §4.2 and not §4.1 or §4.3

- **Not §4.1 (`box-decoration-break: clone`).** That technique requires
  the highlighted region to be a single inline element. The production
  markup has each token wrapped in its own `<span class="relative">`
  (for word-level click/hover), and the highlight is *not* applied as a
  background on those spans — it's a sibling overlay. §4.1 cannot draw
  a highlight that spans across N independent inline spans without
  re-wrapping them in a parent inline, and there is no such parent.
- **Not §4.3 (CSS Custom Highlight API).** `::highlight()` can only set
  text-paint properties — `color`, `background-color`, `text-decoration*`,
  `text-shadow`, `-webkit-text-stroke-*`. No `border-radius`, no
  rounded shapes. The production pills have visibly rounded corners
  (the SVG path uses `Q` quadratic-curve commands). Rules §4.3 out.
- **Is §4.2.** The geometry comes from measurement (the `d` attribute is
  numeric, per-line, and changes with layout). The overlay is a sibling
  with `pointer-events: none`. The text node is untouched by the
  highlight. That's §4.2 by definition.

### What the markup actually looks like

Each paragraph (`reader-api-block`) is a `position: relative` container.
Inside it:

```html
<div class="whitespace-pre-wrap flex flex-col reader-api-block"
     style="padding-top: 10px; padding-bottom: 10px; cursor: default;">

  <!-- highlight layer 1: sentence/passage (yellow) -->
  <div class="absolute pointer-events-none" style="inset: -10px;">
    <svg width="639.16" height="366.96" viewBox="-10 -10 639.16 366.96"
         style="fill: var(--color-hglt-sec);">
      <path d="M 20.89,346.97 Q 11.89,346.97,11.89,337.97
               L 11.89,327.25 Q 11.89,318.25,15.265,318.25
               L 15.265,318.25 Q 18.64,318.25,18.64,309.25
               L 18.64,299.17 Q 18.64,290.17,27.64,290.17
               ... Z"/>
    </svg>
  </div>

  <!-- spacer / hit layer (empty SVG sized to the block) -->
  <div class="absolute" style="inset: -10px; pointer-events: none;">
    <svg width="660" height="376.94" viewBox="-10 -10 660 376.94"></svg>
  </div>

  <!-- highlight layer 2: current word (blue) -->
  <div class="absolute pointer-events-none" style="inset: -10px;">
    <svg width="384.93" height="310.80" viewBox="-10 -10 384.93 310.80"
         style="fill: var(--color-hglt-prim);">
      <path d="M 341.3,290.81 Q 332.3,290.81,332.3,281.81
               L 332.3,271.09 Q 332.3,262.09,341.3,262.09
               L 355.94,262.09 Q 364.94,262.09,364.94,271.09
               L 364.94,281.81 Q 364.94,290.81,355.94,290.81 Z"/>
    </svg>
  </div>

  <!-- the prose itself -->
  <p style="font-family: Georgia, ...;">
    <span class="relative"><span class="no-selection-color pointer-events-auto"
      style="font-size: 18px; --font-size: 18px;">The properties page had a zone filter that worked by comparing text strings.</span></span>
    <span class="relative">…</span>
    …
  </p>
</div>
```

Several things to call out in that markup:

- **`inset: -10px` bleed.** The overlay extends 10 px past each side of
  the block. That's so a highlight pill can stick out past the
  paragraph's `padding-top: 10px; padding-bottom: 10px;` without being
  clipped — a sentence highlight visually starts a hair above the
  first line and ends a hair below the last, exactly matching the
  reference pill geometry.
- **`viewBox` includes the bleed.** `viewBox="-10 -10 W H"` — the SVG
  coordinate system is shifted by `(-10, -10)` so the path `d` values
  can be expressed in block-local pixel coordinates (the same numbers
  you'd get from `getClientRects()` minus the block's bounding rect).
  Zero post-measurement arithmetic needed in the path.
- **Path is in `M…Q…L…Q…L… Z` form.** Quadratic-curve corners
  (`Q cx,cy x,y`) joining horizontal/vertical line segments (`L`). The
  control point of each `Q` sits at the rect corner; the curve endpoints
  are the radius-inset points. That's a classic rounded-rect SVG
  emission.
- **The path is *one continuous outline*, not N rects.** Trace the
  numbers in the first path: it starts at the bottom-left of one line
  rect, climbs up, jogs *horizontally* across to the next line's width,
  climbs up again, etc. — meaning it's drawing the union of all per-line
  `DOMRect`s as one shape, with rounded joins between lines, instead of
  drawing each rect as a separate shape. This is the production answer
  to the same problem §4.1's `box-shadow` spread trick solves — making
  consecutive line fragments read as one continuous pill rather than
  three disjoint pills.
- **Two layers, two colours, separately sized SVGs.** The yellow
  sentence layer is sized to its bounding box (`639 × 367`), the blue
  word layer to its bounding box (`385 × 311`). Each SVG is just large
  enough to hold its own outline; they compose in DOM order. No
  z-fighting because they're siblings in document order with
  `pointer-events: none` and they paint behind the prose (the prose
  comes after them in DOM, and they're `position: absolute` while the
  prose is in flow).
- **A third sibling div with `pointer-events: none` and an empty SVG**
  sized to `660 × 376.94`. We don't know for certain what it's for from
  one snapshot, but the size matches the paragraph's full content box
  including the 10 px bleed (`viewBox="-10 -10 660 376.94"`). Best
  guess: it's a measurement / hit-instrumentation layer, or a reserved
  slot for a third highlight role (hover sentence) currently empty
  because the page is paused and nothing is hovered. Worth confirming
  by watching the DOM while moving the mouse.

### Tokens / prose markup

Every token is wrapped twice:

```html
<span class="relative">
  <span class="classic-text-responsive no-selection-color pointer-events-auto"
        style="font-size: 18px; --font-size: 18px;">word</span>
</span>
```

Inferences:

- **Outer `<span class="relative">`** establishes a positioning context
  per token. Likely used as the anchor for per-word UI (hover
  popovers — define-this-word, copy, etc.) without re-measuring.
- **Inner span carries `pointer-events-auto`.** The highlight overlay
  has `pointer-events: none` so clicks land here, on the token, which
  is the right click target for click-to-seek. The class
  `no-selection-color` is interesting — Speechify wants its own
  highlight colour to win over the OS selection colour, so they suppress
  the default `::selection` background on tokens that are currently
  highlighted (presumably toggled by a class on the container).
- **Token = one word, including following whitespace as its own token.**
  Inside the paragraph, runs alternate between word-tokens and a
  single-character whitespace token, each wrapped the same way. That
  matches the `Intl.Segmenter` `granularity: 'word'` output — ICU emits
  whitespace as a separate "word-like" segment with `isWordLike: false`.
  Production keeps them as DOM nodes too, presumably so the
  `(node, offset) → word_index` mapping for click-to-seek is a direct
  `closest('span.relative')` lookup with no offset arithmetic across
  text nodes.
- **`font-size` is set inline AND mirrored to a `--font-size` CSS
  custom property.** The custom property is the source of truth used
  by the reader's responsive type scale (`classic-text-responsive`
  presumably reads `var(--font-size)` and clamps or scales it).
  Setting both is so the inline value is the unscaled baseline and the
  custom property is the value the cascade actually paints. Reasonable
  defensive pattern for a user-resizable reader.
- **Code spans get `<code class="whitespace-pre-wrap inline">` around
  the same token-span structure.** Inline code keeps the per-token
  hit-testing. The reader is markdown-aware enough to preserve `code`,
  `em`, `strong`, lists, headings — they all live in the
  `reader-api-block` family.

---

## 2. Block layer — `reader-api-block` and absolute positioning

Each top-level block (heading, paragraph, list, code block) is rendered as
a `reader-api-block` with `position: absolute` and a precomputed `top`
relative to a sized `<section>` parent:

```html
<section style="contain: size style paint; overflow-anchor: none;
                overflow: clip; flex: 0 0 auto; position: relative;
                width: 100%; height: 6636.22px;">
  <div style="contain: layout style; position: absolute; width: 100%;
              left: 0px; top: 0px; visibility: visible;">
    <div class="reader-api-block">…heading 1…</div>
  </div>
  <div style="contain: layout style; position: absolute; width: 100%;
              left: 0px; top: 84.88px; visibility: visible;">
    <div class="reader-api-block">…heading 2…</div>
  </div>
  <div style="contain: layout style; position: absolute; width: 100%;
              left: 0px; top: 163.52px; visibility: visible;">
    <div class="reader-api-block">…paragraph…</div>
  </div>
  …
</section>
```

This is the virtualization scaffolding §10 mentions in LEARN.md, but
applied to *all* documents, not just long ones. What it gives you:

- **`section` has an explicit `height`** that is the sum of every block's
  rendered height — `6636.22px` here. That's the scroll height for the
  document. The browser doesn't have to layout-flow N blocks to compute
  it; it's precomputed and pinned.
- **Each block is `position: absolute`** at a precomputed `top`. No
  block contributes to the section's height through flow. Inserting,
  removing, or re-measuring a block doesn't shift its neighbours' `top`
  values — they're independent. That makes per-block re-measurement
  cheap and predictable.
- **`contain: layout style`** on every block — and `contain: size style
  paint` on the section. CSS containment is a hard promise to the
  browser that layout/paint inside the container can't affect anything
  outside it, which lets the engine skip work for off-screen blocks.
  `contain: size` on the section pins the size; `contain: paint`
  prevents children from painting outside; `style` contains
  counter/quote scope. This is the perf-critical detail — without
  containment, the layout/paint optimisations the virtualizer relies on
  don't kick in.
- **`visibility: visible`** is explicit on each wrapper. Off-screen
  blocks (not in this snapshot, but inferable from the pattern) likely
  flip to `visibility: hidden` to skip painting while keeping layout
  bounds. They can also be detached entirely if the recycler decides
  the window is too far away — the precomputed `top` means re-attaching
  doesn't shift anything.
- **`overflow-anchor: none`** on the section disables Chrome's scroll
  anchoring. Speechify wants to control scroll position itself (see §3
  of LEARN.md and §3 below) — letting the browser silently adjust
  `scrollTop` when content above the viewport mutates would fight the
  reader's auto-scroll logic.

So the document model is closer to a recycler/virtualizer than a normal
flow document. Each block is an independent absolutely-positioned unit
the reader can re-measure, re-highlight, hide, or recycle without
touching anything else.

---

## 3. The reader-scroll-container

```html
<div data-reader-scroll-container="true" tabindex="-1"
     class="w-full flex-shrink flex-grow overflow-y-auto outline-none
            scrollbar-default"
     style="overflow-anchor: none; user-select: text;">
```

- **`overflow-y-auto`** — this is the scrollport. Auto-scroll
  (`scrollBy` etc.) targets *this* element, not `window`.
- **`tabindex="-1"`** — programmatically focusable but not in the tab
  order. Lets keyboard shortcuts that need a focused container work
  without giving keyboard users a useless tab stop.
- **`outline-none`** — paired with the `tabindex="-1"`, suppresses the
  default focus ring on programmatic focus.
- **`overflow-anchor: none`** — second occurrence, same reason: the
  reader manages scroll itself.
- **`user-select: text`** — explicit, because elsewhere the chrome
  uses `user-select: none`. Inside the reader, prose is selectable, so
  the Selection API (LEARN.md §5) can drive "play selection."

Content padding is applied on the inner `webreader` element, not the
scroll container:

```html
<div class="webreader overflow-hidden classic-reader reader-api-based
            relative text-text-primary text-classic-reader-body-4
            flex flex-col items-center"
     style="padding-top: 61px; padding-bottom: 136px;">
```

`padding-top: 61px` clears the fixed top nav (which is itself `53px`
tall plus an 8px gap). `padding-bottom: 136px` clears the floating
player widget (`128px` tall on mobile + 8px gap). These are the
"comfortable region" margins LEARN.md §6 talks about, made concrete:
auto-scroll's keep-on-screen margins should be at least these values
plus the 40 px / 140 px buffer, because anything inside the padding is
visually under the nav or under the player.

---

## 4. The player widget — what's wired to what

```html
<div data-player-container="true" id="speechify-web-player"
     class="… max-w-[348px]"
     style="z-index: 100; …; box-shadow: 0 6px 16px rgba(0,0,0,0.64);">
```

The player is `position: fixed` at the bottom-centre of the viewport.
Inside it, several `data-testid`-tagged controls map cleanly onto the
contract from LEARN.md §0–§5:

- `data-testid="player-play-button"` — `aria-label="Play"`. Toggles
  `audio.paused`. Container also has `<div aria-live="polite"
  class="sr-only">Paused</div>` — that's the §9 pattern: live region
  for *app-level* events (play/pause state), never for per-word.
- `data-testid="player-backward-button"` / `player-forward-button` —
  `aria-label="Skip back 10 seconds"` etc. Bound to `audio.currentTime
  -= 10` / `+= 10`. These animate (lottie SVGs in the markup) which
  means whoever wired them has to gate the animation on
  `prefers-reduced-motion` (LEARN.md §9). Worth checking if they do.
- `data-testid="player-speed-button"` — shows `1×`. Speed picker;
  drives `audio.playbackRate`. The label format `Nx` (no space, lowercase
  `x`) is the Speechify house style; consistent across the marketing
  site too.
- `data-testid="player-voice-button"` with `data-voice-name="Samantha"`
  and a flag image `https://cdn.speechify.com/web/flags/US.svg`. Voice
  picker, opens a voice list. The flag URL pattern is interesting —
  voices keyed to a country code, served as flat SVGs from their CDN.
- **Progress bar**, `role="progressbar"`, `aria-valuenow="4"`,
  `aria-valuemin="0"`, `aria-valuemax="100"`,
  `aria-label="Listening progress"`. The bar's inner div carries
  `style="width: 3.89392%;"` — so production is reading
  `currentTime / duration * 100` to a high-precision percent, not
  rounding. That percent is also exposed via the toggle button:
- **`data-testid="progress-time-toggle"` and `progress-duration-toggle"`**
  — buttons that swap between mm:ss and percent display. The
  `aria-label`s are full sentences ("Listened: 29 seconds, switch to
  percentage", "Duration: 12 minutes 39 seconds, switch to time left").
  That verbosity is for screen reader users — the visible text "0:29" /
  "12:39" is opaque, the label is the announce-friendly version.
- **Idle-fade transition**: the inner controls carry
  `transition-opacity duration-150 ease-in-out opacity-100 delay-200`.
  Reading the class wiring: when the player is "active" the controls
  are opaque; when idle (after some hover-out delay) they fade.
  Standard floating-player UX.

The player's bottom anchor is `bottom-4 md:bottom-6`. The reader's
content padding is `136px`. `48px` button + `16px` margin + a bit of
breathing room — checks out as "controls don't overlap the last line of
prose."

---

## 5. AI shortcut rail (left side)

Four buttons stacked at top-left:

- `ai-shortcut-button-open-ai-chat` → "Chat"
- `ai-shortcut-button-generate-ai-summary` → "Summary"
- `ai-shortcut-button-generate-ai-podcast` → "Podcast"
- `ai-shortcut-button-generate-ai-quiz` → "Quiz"

Each is a `.bg-sf-prim-w-90` pill with icon + label. They're outside the
core reading-and-listening surface, but worth noting because the layout
contract is: top-nav `53px` + left rail `~200px` wide × N buttons +
right rail (zoom controls + help FAB, ~32px wide) + bottom player. The
reader content is centred between the rails and constrained to
`width: min(100%, 768px)` with `padding: 48px 64px`. That gives ~640 px
of measure, which is the prose-readability sweet spot (~80 chars at
18 px Georgia).

---

## 6. Top nav

```html
<nav data-reader-topnav="true"
     class="bg-bg-prim-w-110 border-b-s border-brdr-prim-10-80 fixed flex z-10"
     style="height: 53px; width: calc(100% - 10px); …">
```

Three regions:

- **Left**: back button, annotations button.
- **Centre**: file title button (`zone.md`), with a `▼` icon — opens a
  file-actions menu.
- **Right**: bookmark, find (⌘+F), settings, share.

`width: calc(100% - 10px)` is to leave a 10 px gap on the right where a
separately-rendered "scrollbar gutter" sits (`<div class="fixed right-0
… w-[10px]">`). That's an interesting choice — they're reserving
scrollbar space at the nav level so the nav doesn't visually overlap a
floating scrollbar on macOS. (Confirmed: page is rendered on darwin per
`data-platform="macos"` on `<html>`.)

`bookmark-button` carries `aria-label="Add bookmark (⌘+B)"` — keyboard
shortcut for bookmarking, which matches LEARN.md §5's recommendation to
use `e.key === 'b'` for character-meaning shortcuts.

`nav-search-button` is `aria-label="Find text (⌘+F)"` — overrides the
browser's built-in find. Reasonable for a reader where the visible
prose is virtualized and the browser find would miss off-screen blocks.

---

## 7. CSS custom properties / theming

The reader uses a CSS-custom-property design system. Names that show up
in the snapshot:

- Highlight colours: `--color-hglt-sec`, `--color-hglt-prim`. Two slots,
  used by the two SVG fills.
- Surfaces: `--bg-prim-w-110`, `--bg-prim-w-90`, `--bg-prim-w-b`,
  `--bg-prim-w-70`, `--bg-sec-0-90`. The `w-NN` suffix looks like an
  opacity/lightness scale. `w-b` is the most distinctive — used as the
  reader body background; `dark:bg-transparent` swaps it out in dark
  mode.
- Text/icon: `--icn-txt-prim`, `--icn-txt-sec`, `--icn-txt-blue`,
  `--icn-txt-white`.
- Borders: `--brdr-prim-10-80`.
- Interaction states: `--sf-prim-hov-w-110`, `--sf-prim-pres-w-110`,
  `--sf-prim-cta`, `--sf-prim-cta-hov`, `--sf-prim-cta-pres`,
  `--bg-blue`, `--bg-dimmer`.
- Per-token font scaling: `--font-size` on every token span.

`<html class="font-app dark" data-platform="macos">` — `font-app` is
their app type stack, `dark` is the colour scheme, and `data-platform`
gates platform-specific styles (macos here likely tweaks scrollbar and
keyboard-shortcut hint rendering).

---

## 8. What we couldn't see from a paused snapshot

Honest about the limits of one static HTML capture:

- **Tokenization source.** We can see the per-token wrapping but not
  whether it came from `Intl.Segmenter`, from the server, or from a
  Speechify-internal segmenter. The shape (word + whitespace as
  separate segments) is consistent with `Intl.Segmenter`, but not
  uniquely so.
- **Time-sync loop.** The snapshot is paused. We can't see whether the
  highlight advances on `rAF`, `timeupdate`, `setInterval`, or
  something else. The fact that the progress bar width is
  `3.89392%` (lots of decimals) suggests a high-frequency update,
  consistent with `rAF`, but not a proof.
- **Click-to-seek mechanism.** We can see `pointer-events-auto` on
  tokens, so they're click targets. We can't see whether the handler
  uses `caretPositionFromPoint` or relies on the token wrappers'
  `data-` attributes. The fact that every token is a DOM node suggests
  the latter — it's cheaper to read `event.target.closest('span.relative')`
  and look up a stored index than to caret-hit-test.
- **Hover sentence highlight.** The "spacer" SVG between the two
  highlight layers is the most likely candidate for a third highlight
  role, but the snapshot was paused and not hovered, so we don't see
  it populated. Worth verifying.
- **Auto-scroll trigger.** The keep-on-screen margins (LEARN.md §6) and
  whether they obey `prefers-reduced-motion`. The content padding
  (`61px` top, `136px` bottom) gives a hint at minimum margins but not
  at the buffer above that.
- **Persistence cadence.** No way to see `localStorage`/`IndexedDB`
  writes from rendered HTML.

---

## 9. Implementation recipe — what to copy

If we want to upgrade `/speechify/range-rects` to match production's
look, the changes are scoped:

1. **Per-block overlay container** with `position: absolute; inset:
   -10px; pointer-events: none;` as a child of each
   `position: relative` paragraph wrapper. One overlay per highlight
   role (sentence, word, hover-sentence) — separate SVGs in DOM order
   so they composite in registration order.

2. **Replace the array-of-divs renderer with one SVG `<path>`.**
   Algorithm:
   - Get `range.getClientRects()` for the current highlight range.
   - Subtract the overlay's `getBoundingClientRect()` from each rect
     (your overlay has `inset: -10px`, so subtract the *content* rect
     and the path numbers naturally fall in `[-10, W+10] × [-10, H+10]`).
   - Build a single `d` string that traces the outline of the union of
     the rects, with quadratic-curve corners of radius `r` (Speechify
     uses ~9 px — pick what looks right at your type size). The
     "snake" pattern is: top-left of first rect → top-right of first
     rect → step down to top-right of second rect (with rounded inside
     corners on both sides of the step) → ... → bottom-left of last
     rect → close. Edge cases: single-line range = plain rounded
     rectangle; second line longer than first = concave join (the
     "step out"); second line shorter = convex join (the "step in").
   - Set the SVG's `viewBox` to `-10 -10 W H` where `W × H` is the
     overlay's bounding box plus the 20 px bleed.

3. **Fill via CSS custom property**, e.g.
   `style="fill: var(--color-hglt-prim);"`. Lets the same SVG mark be
   reused across themes.

4. **Keep prose unwrapped (for the highlight)** — token spans for click
   targets only, no `<mark>`, no class-toggled background. The highlight
   is *exclusively* the SVG layer.

5. **`pointer-events: none`** on the overlay, **`pointer-events: auto`**
   on the inner token span. The outer per-token `<span class="relative">`
   doesn't need `pointer-events` either way; it's the inner one that
   takes clicks.

6. **`aria-hidden`** on the overlay — even though the §4.2 example
   already does this, worth restating. The highlight is decorative; the
   audio is the announcement (LEARN.md §9).

For a fully production-grade version, layer in:

- **`reader-api-block` virtualization.** `<section>` with explicit
  total height, each block `position: absolute` at a precomputed `top`,
  `contain: layout style` on each block, `contain: size style paint` on
  the section, `overflow-anchor: none` on the section *and* the scroll
  container. Pays off at 10k+ blocks.

- **Per-token whitespace tokens.** Whitespace as its own `<span class
  ="relative">`. Makes click-to-seek hit-testing a `closest()` lookup
  with no offset arithmetic across text nodes. Compatible with the
  `Intl.Segmenter` output shape.

- **`no-selection-color` class** that suppresses `::selection`
  background on tokens — so the OS selection doesn't double up with the
  reader's own highlight when the user drags a selection across an
  already-highlighted region.

- **CSS-custom-property type scale.** `--font-size: 18px;` mirrored
  with `style="font-size: 18px"`, with the component reading
  `var(--font-size)` through a clamp-like responsive utility.

---

## 10. Quick comparison to our three examples

| Concern | LEARN.md §4.1 (box-decoration) | LEARN.md §4.2 (range-rects) | LEARN.md §4.3 (Highlight API) | **Production (observed)** |
| --- | --- | --- | --- | --- |
| Primitive | inline `<span>` background | absolute `<div>` per `DOMRect` | named `Highlight` against a `Range` | absolute SVG `<path>` from `getClientRects()` |
| Rounded corners | `border-radius` | `border-radius` on each `<div>` | impossible | quadratic curves in `d` |
| Continuous pill across lines | `box-shadow` spread trick | gap between line `<div>`s unless you fudge | line-box-painted, no gaps but flat | one outline → genuinely continuous |
| Layout/measurement | zero | per-resize / per-font-load | zero | per-resize / per-font-load |
| DOM mutation per highlight | class toggle | append/remove `<div>`s | zero | replace one `<path d>` attribute |
| Sub-range across boundaries | no | yes | yes | yes |
| Multiple layers | nested spans | stacked div layers | named highlights in registration order | sibling SVG layers in DOM order |
| Pick which | default | when prose must stay clean | when shape can be flat | when you want §4.2's flexibility + §4.1's look |

Production picked §4.2 because they need sub-range support (the prose
is broken into per-token spans for click-to-seek and other word-level
features, so no single inline ancestor exists for §4.1). They paid the
measurement cost. In return, they get pill shapes (which §4.3 can't
give) and a genuinely continuous outline across lines (which neither
§4.1 nor a naive §4.2 give without extra work).

---

## 11. References

- LEARN.md — our reference for the three techniques and the rest of the
  reader contract.
- Snapshot source: `https://app.speechify.com/item/<uuid>` (paused
  reader, 2026-06-15), captured as serialized DOM.
