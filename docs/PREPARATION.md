# Speechify Tech Lead — Web Core Product & Chrome Extension

Problem-by-problem prep for the three technical rounds, derived from
the Glassdoor reviews in `REVIEWS.json` and filtered to the role
described in the JD. The reviews span backend, mobile, and full-stack
positions; this document keeps only what aligns with **front-end /
React / Web APIs / Chrome extension** work. Everything Swift,
backend-Node, Java, Python, job-queue, and pure-backend systems has
been discarded.

If `LEARN.md` is the *why this app is built this way*, this is the
*here is what they will ask, and here is the keystroke-level solution
under 90 minutes with no AI, no StackOverflow, no Copilot, camera on*.

The three rounds, mapped:

- **Round 1 — Web AI Assessment, 90 min, take-home, recorded.** A
  GitHub repo, fill in missing functionality, tests must pass. The
  reviews are unambiguous: **LRU cache with TTL + SSML parser
  (string→tree) + SSML serializer (tree→string)**, occasionally an
  SSML-to-plain-text decoder, sometimes a React/TS refactor instead.
  Sections 1–3 and 7 of this doc.
- **Round 2 — Live DOM coding + leadership, 60 min, browser console.**
  JS Web APIs, multiple problems, talk through everything. The reviews
  surface two recurring shapes: **find top-level "readable" nodes by
  parsing HTML** and **get the first-line height of a paragraph**.
  Both are exactly the Chrome-extension problem the JD names. Sections
  4–6 and 9 (leadership).
- **Round 3 — Coding & problem solving, 60 min.** DSA + web parsing.
  The reviews suggest XML/SSML parsing recurs here too, plus classic
  DSA (balanced parens). Sometimes lightweight system design
  (autocomplete). Sections 1, 2, 7, 8.

A note on language: the JD asks for JavaScript in the live rounds.
TypeScript is fine in the take-home (one review explicitly confirms
the assessment is TS/React). Code below is TS with types you can
strip; in the browser console, paste the JS shape and skip the
annotations.

The non-negotiable, common to every review: **practice it cold,
typed, no autocomplete, no AI**. 90 minutes for three problems means
~25 minutes each with 15 minutes for the chaos of git clone, repo
setup, and reading the rubric. The solutions below are sized to be
re-derivable from memory in 20 minutes once you've internalized the
shape.

---

## 1. The SSML cluster — parser, serializer, decoder

Mentioned in: pages 1/1, 2/1, 2/4, 3/1, 3/3, 3/5, 4/2, 4/3, 4/4, 5/2,
5/4, 8/1, 8/3, 9/3, 10/1, 11/5, 12/2. This is **the** Speechify
take-home. If you only prep one thing, prep this.

### What they ask

Three sub-problems, sometimes split, sometimes fused:

1. Given an SSML string, parse it into a node tree. **No `DOMParser`,
   no XML libraries.**
2. Given a node tree, serialize it back to a string (round-trip).
3. Given a node tree (or string), extract plain text from inside
   `<sentence>` elements only — discard wrappers, comments, invalid
   text.

SSML is a strict subset of XML used by TTS systems. For Speechify's
purposes you can assume a small tag set — `speak`, `voice`,
`sentence`, `s`, `p`, `break`, sometimes `prosody` — and a single
quote style for attribute values. The review on page 3/3 warns the
test cases are **strict on whitespace**: a tag with a leading space
(`< speech >`) is invalid XML and your parser should reject it. Take
their tests literally.

### The shared node shape

The same shape powers all three exits. Internalize this and you write
each function in 5 minutes.

```ts
type SsmlNode =
  | { kind: 'element'; tag: string; attrs: Record<string, string>; children: SsmlNode[] }
  | { kind: 'text'; value: string };
```

That's it. No CDATA, no processing instructions, no namespaces. Real
SSML has more; the assessment doesn't.

### Parser — string → tree

The clean implementation is a recursive-descent parser with a single
cursor. **One pass, no regex on the whole input** — regex on
unbalanced markup is how you ship a bug in front of a camera. Regex
for tokens (tag names, attributes) is fine.

```ts
function parse_ssml(input: string): SsmlNode {
  let i = 0;

  function peek(s: string): boolean {
    return input.startsWith(s, i);
  }

  function expect(s: string): void {
    if (!peek(s)) throw new Error(`expected ${s} at ${i}`);
    i += s.length;
  }

  function skip_ws(): void {
    while (i < input.length && /\s/.test(input[i])) i++;
  }

  function read_name(): string {
    const m = /^[a-zA-Z_][a-zA-Z0-9_-]*/.exec(input.slice(i));
    if (!m) throw new Error(`expected name at ${i}`);
    i += m[0].length;
    return m[0];
  }

  function read_attrs(): Record<string, string> {
    const attrs: Record<string, string> = {};
    while (true) {
      skip_ws();
      if (peek('>') || peek('/>')) return attrs;
      const name = read_name();
      expect('=');
      const quote = input[i];
      if (quote !== '"' && quote !== "'") throw new Error(`bad quote at ${i}`);
      i++;
      const start = i;
      while (i < input.length && input[i] !== quote) i++;
      attrs[name] = input.slice(start, i);
      expect(quote);
    }
  }

  function parse_element(): SsmlNode {
    expect('<');
    // strict: no whitespace allowed after '<'
    if (/\s/.test(input[i])) throw new Error(`whitespace after < at ${i}`);
    const tag = read_name();
    const attrs = read_attrs();
    if (peek('/>')) { i += 2; return { kind: 'element', tag, attrs, children: [] }; }
    expect('>');
    const children: SsmlNode[] = [];
    while (!peek(`</`)) {
      if (peek('<')) children.push(parse_element());
      else children.push(parse_text());
    }
    expect('</');
    const close_tag = read_name();
    if (close_tag !== tag) throw new Error(`tag mismatch ${tag} vs ${close_tag}`);
    skip_ws();
    expect('>');
    return { kind: 'element', tag, attrs, children };
  }

  function parse_text(): SsmlNode {
    const start = i;
    while (i < input.length && input[i] !== '<') i++;
    return { kind: 'text', value: decode_entities(input.slice(start, i)) };
  }

  function decode_entities(s: string): string {
    return s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&'); // amp last so we don't double-decode
  }

  skip_ws();
  const root = parse_element();
  skip_ws();
  if (i !== input.length) throw new Error(`trailing content at ${i}`);
  return root;
}
```

**Decisions worth defending out loud:**

- **Single cursor `i` over a substring slice.** Allocating new strings
  on every recursion is the classic O(n²) trap.
- **Reject whitespace after `<`** (the page 3/3 review specifically
  flags this as a thing their tests get wrong, but a correct parser
  rejects it).
- **Decode `&amp;` last.** Decoding it first would turn `&amp;lt;`
  into `<`, which is wrong.
- **Tag-mismatch is an error**, not recovery. SSML is strict.
- **No `parse_attrs` regex on the whole tag** — quoted attribute
  values can contain `>`, so a naïve `<[^>]+>` regex breaks. The
  cursor-based read handles it.

### Serializer — tree → string

The mirror. Encode entities in text nodes, quote attributes. Self-
closing for empty elements is a style choice; either is valid SSML.

```ts
function serialize_ssml(node: SsmlNode): string {
  if (node.kind === 'text') return encode_entities(node.value);
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${encode_attr(v)}"`)
    .join('');
  if (node.children.length === 0) return `<${node.tag}${attrs}/>`;
  const inner = node.children.map(serialize_ssml).join('');
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
}

function encode_entities(s: string): string {
  return s
    .replace(/&/g, '&amp;') // amp first
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function encode_attr(s: string): string {
  return encode_entities(s).replace(/"/g, '&quot;');
}
```

**Decisions:** `&amp;` first now (opposite of decode). Attribute
values additionally escape `"`. Round-trip: `serialize(parse(x))`
should equal `x` for any canonical input.

### Decoder — tree → plain text from `<sentence>` only

The page 1/1 prompt is the explicit one: extract text **solely** from
`<sentence>` elements, strip all other wrappers. Two implementations
depending on whether they want concatenation across sentences or a
list.

```ts
function decode_sentences(root: SsmlNode): string[] {
  const out: string[] = [];
  function visit(n: SsmlNode, inside_sentence: boolean): void {
    if (n.kind === 'text') {
      if (inside_sentence) out[out.length - 1] += n.value;
      return;
    }
    if (n.tag === 'sentence' || n.tag === 's') {
      out.push('');
      for (const c of n.children) visit(c, true);
      return;
    }
    for (const c of n.children) visit(c, inside_sentence);
  }
  visit(root, false);
  return out.map(s => s.trim()).filter(Boolean);
}
```

The shape — pre-order traversal with a flag for "are we inside the
relevant scope" — generalizes to *every* tree-extraction question
they could ask.

### Time budget

Parser: 12 min. Serializer: 5. Decoder: 5. That leaves 8 minutes for
test debugging. Total: 30. Drill it until you hit that.

### Tie to `LEARN.md`

The runtime in this repo doesn't parse SSML — the contract (§0) is
already-tokenized JSON from `/whisper`. Tokenization runs offline
precisely because parsing inside an animation frame is wrong. The
interview asks the offline-tokenizer's job because that's the part
that's interesting under pressure.

---

## 2. LRU cache with TTL

Mentioned in: 2/1, 3/1, 3/2, 3/3, 4/4, 6/3, 8/1, 8/3, 9/3, 10/1,
11/5. Almost as common as SSML; often paired with it.

### What they ask

A `LruCache<K, V>` with `get(k)`, `set(k, v)`, `capacity`, and a
**per-entry TTL** in milliseconds. Expired entries must not be
returned from `get`, must count as "not present" for `set` collision
handling, and (depending on rubric) should be evicted lazily on
access or eagerly on a timer. **Default to lazy** — it's simpler and
matches normal LRU semantics.

### The right data structure

Pure JS `Map` preserves insertion order. That's the entire LRU
implementation in eight lines. Don't roll your own doubly-linked list
unless they explicitly forbid `Map`.

```ts
type Entry<V> = { value: V; expires_at: number };

class LruCache<K, V> {
  private readonly map = new Map<K, Entry<V>>();

  constructor(
    private readonly capacity: number,
    private readonly ttl_ms: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expires_at <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // refresh recency: delete + re-insert moves to the back
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.capacity) {
      // evict LRU = first key in insertion order
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
    this.map.set(key, { value, expires_at: this.now() + this.ttl_ms });
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  get size(): number {
    return this.map.size;
  }
}
```

**Decisions worth defending:**

- **`Map` insertion-order trick.** The reason `Map` exists with
  ordered semantics; abuse it.
- **`now` is injected.** Tests will fake time. Hard-coding `Date.now`
  makes you fail their fake-timer tests. This is the single most
  common reason people fail this question.
- **TTL is checked in `get`, not on a timer.** A `setInterval` sweep
  works but leaks if nobody calls `dispose`. Lazy is correct.
- **`set` on existing key refreshes TTL.** If their tests want
  "preserve original expiry", swap the `set` branch to keep
  `expires_at`. Read the rubric.
- **Eviction picks first key in `keys()`.** First-inserted = least-
  recently-used because every access re-inserts.

### Variant — TTL per-entry rather than per-cache

If `set(key, value, ttl_ms_for_this_entry)`, the cache constructor
loses its TTL argument and `set` takes one. One-line change.

### Time budget

7 minutes. This is the easy one in the take-home. **Do not** make it
the time-sink — the SSML parser is the gauntlet, save your minutes
for it.

---

## 3. Refactor / find-bugs exercise

Mentioned in: 1/2, 1/3, 2/5, 3/1, 3/2, 4/1, 10/4. The framing
varies — "refactor this TS service", "fix 5 issues in production
code", "restructure this code" — but the playbook is the same.

### What they ask

A repo with working-but-bad code and a test suite. You either make
the tests pass, refactor to a stated quality bar, or find planted
bugs. The page 4/1 review's complaint is real: **they often say
"don't focus on tests" while also "behavior must be preserved"**.
Treat that as: don't write *new* tests, but *run* the existing ones
constantly.

### The playbook, sequenced

1. **Read the README first.** 90 seconds. The reviews complain about
   vague rubrics; the rubric *is* there, you just have to look. What
   does "done" mean?
2. **Run the tests, see what fails.** Before reading any code. The
   failing-test list is the spec.
3. **For each failing test, read just the code it exercises.** Do not
   read the whole repo. You have 90 minutes; you cannot.
4. **Smallest possible change per fix.** Commit often. The page 4/1
   reviewer expected you to add tests; the rubric says don't. Trust
   the rubric.
5. **Last 10 minutes: stop refactoring, get green.** A green test
   suite with ugly code beats elegant code with two failures.

### Common bug shapes they plant

- Off-by-one in a slice / range / index.
- Mutation of shared state where a clone is needed.
- `==` vs `===` (especially `null` vs `undefined`).
- Async race: `Promise.all` where order matters, missing `await`.
- Stale closure in a React hook (missing dep, captured first-render
  value).
- Event listener added without cleanup → memory leak detected by
  test.
- `parseInt` without radix.
- `Array.sort` without comparator on numbers (`[10, 2].sort()` →
  `[10, 2]`).
- `for...in` on an array.

### What to say out loud

"Reading README. Running tests. Three failures. Looking at
`foo.ts`." Narrate every action. The reviewers complain the format
gives no signal; *you* make the signal by talking through it. The
camera is your audience.

---

## 4. Find top-level "readable" nodes by parsing HTML

Mentioned in: 7/1 (`Find top level readable nodes by parsing HTML`),
echoed by 6/5, 7/3, 7/4 (DOM traversal, mouse events). **This is the
Chrome-extension problem the JD calls out by name.** Round 2,
near-certain.

### What they ask

Given a page, return the DOM nodes that contain "readable" prose —
i.e., the things a TTS reader should read. Skip nav, footer, ads,
script, style. Variations:

- "Return the top-level readable elements."
- "Given a click, find the readable block the click landed in."
- "Implement Reader Mode lite."

There is no single correct definition of "readable" — that's the
point. They want to see you reason about a fuzzy heuristic and code
it.

### A defensible heuristic

Readable = an element that contains meaningful prose, is visible,
isn't a control, and isn't structurally a sibling-list (nav, menu,
list of links). Three signals — **text density**, **visibility**,
**tag/role** — composed.

```ts
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE',
  'NAV', 'HEADER', 'FOOTER', 'ASIDE',
  'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'FORM',
  'IFRAME', 'SVG', 'CANVAS',
]);

function is_visible(el: Element): boolean {
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (parseFloat(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function text_length(el: Element): number {
  // textContent strips tags; trim collapses whitespace nodes
  return (el.textContent ?? '').trim().length;
}

function link_density(el: Element): number {
  const total = text_length(el);
  if (total === 0) return 1;
  let link_text = 0;
  for (const a of el.querySelectorAll('a')) link_text += text_length(a);
  return link_text / total;
}

function is_readable(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName)) return false;
  if (!is_visible(el)) return false;
  if (text_length(el) < 100) return false;       // tune
  if (link_density(el) > 0.4) return false;      // nav-like
  return true;
}

function find_readable_blocks(root: Element = document.body): Element[] {
  // Walk top-down, descend until we find a readable element, then stop.
  // The "stop" rule is what makes the result "top-level".
  const out: Element[] = [];
  function visit(el: Element): void {
    if (is_readable(el)) { out.push(el); return; }
    for (const child of el.children) visit(child);
  }
  visit(root);
  return out;
}
```

**Decisions to defend:**

- **Why textContent length, not innerText.** `innerText` triggers
  layout (forced reflow) per call. On a page with 500 candidate
  elements, that's a 500-reflow scan, which freezes the page. Use
  `textContent` for filtering; reach for `innerText` only when
  whitespace-collapsing semantics matter for the final pick.
- **Why link density.** Distinguishes a paragraph (low link density)
  from a nav block (high). Readability.js uses the same signal — it's
  the canonical heuristic.
- **Why "stop descending when found".** Without it, you return a
  paragraph *and* its parent `<article>` *and* `<main>` — nested
  duplicates. The "top-level" framing implies non-overlapping
  results.
- **Why 100 chars / 0.4 ratio.** Magic numbers; say so. In production
  these would be tuned per locale and page class; in interview, name
  the knob.
- **Why `getComputedStyle` for visibility.** `el.hidden` and the
  `hidden` attribute don't cover CSS `display: none` set by a class.
  Computed style is ground truth.

### Variants

**"Given a click at (x, y), find the readable block."** Use
`document.elementFromPoint(x, y)`, then walk up via `parentElement`
until `is_readable` returns true. This is exactly the Chrome
extension's "click anywhere, read from there" interaction.

```ts
function readable_block_at(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y);
  while (el && el !== document.body) {
    if (is_readable(el)) return el;
    el = el.parentElement;
  }
  return null;
}
```

**"Implement reader mode."** Same `find_readable_blocks`, then
concatenate `textContent` in document order. If they push for
ordering: `Node.compareDocumentPosition` gives you the relation
between any two nodes.

### Tie to `LEARN.md`

The repo's home page already *has* its readable content
(`<blockquote>`). The extension's job is the inverse — given an
arbitrary page, *find* the blockquote. Same techniques (Range,
text-node math) apply once you've identified it; the identification
is the new piece.

### Time budget

Round 2 problem. 20 minutes. Be ready to defend every magic number.

---

## 5. First-line height of a paragraph

Mentioned in: 7/1 (`Get the height of the first line of a paragraph
from an element`). Round 2.

### What they ask

Given a paragraph element with multi-line wrapped text, return the
pixel height of just the **first visual line** (a line *box*, not the
whole paragraph, not the CSS `line-height`).

CSS `line-height` is wrong because the first line might contain an
inline element with larger font / image / sup-script that grows the
line box beyond `line-height`. `getBoundingClientRect()` on the
paragraph is wrong because it's the whole block.

### The technique

`Range.getClientRects()` over the paragraph's text returns **one
rect per line box**. The first rect's height is the answer. This is
`LEARN.md` §3, reused.

```ts
function first_line_height(el: HTMLElement): number {
  // find the first text node descendant
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const first_text = walker.nextNode() as Text | null;
  if (!first_text) return 0;

  const range = document.createRange();
  range.setStart(first_text, 0);
  range.setEnd(first_text, first_text.length);

  // extend the range to cover *all* descendants so a line box that
  // straddles inline children still returns correctly
  range.selectNodeContents(el);

  const rects = range.getClientRects();
  return rects.length > 0 ? rects[0].height : 0;
}
```

**Decisions:**

- **`getClientRects()` not `getBoundingClientRect()`.** Bounding is
  the union — useless here. `getClientRects` is per-line-box.
- **`selectNodeContents(el)`.** Covers inline children, not just the
  first text node. A paragraph with `<strong>` mid-line still gets
  the right first-line box because the line box is owned by the
  block.
- **First rect, not min/max.** Rects are returned in flow order, top-
  to-bottom, left-to-right. Index 0 is the first line.
- **Returns 0 for empty.** Don't throw. Empty paragraph has no lines.

### Edge cases to mention

- `text-align: justify` doesn't change height. Safe.
- `transform: scale()` on the paragraph: `getClientRects` returns the
  *transformed* rect. If you need the pre-transform height, use
  `offsetHeight` of a probe element instead.
- `direction: rtl`: still works — first rect is still the first line,
  it just sits on the right.
- Hidden parent (`display: none`): all rects collapse to zero. Return
  0 and move on.

### Tie to `LEARN.md`

Same Range/getClientRects technique that paints the highlight (§3).
This question is the underlying API stripped of the application.

### Time budget

10 minutes. This is a "do you know `Range`?" check. Show the API,
explain the line-box vs bounding-box distinction, move on.

---

## 6. Mouse events + DOM traversal + custom React hook

Mentioned in: 5/5, 6/1, 7/3, 7/4, 8/5, 10/4, 10/5, 11/2. Round 2.

### What they ask

The recurring shape: "write a custom React hook that does X with the
DOM". Variations:

- A hook that highlights the sentence under the cursor on hover.
- A hook that captures the selected text and exposes it.
- A hook that wires keyboard shortcuts at the window level.
- A hook that observes element size.

The page 7/1 review explicitly: "the custom hook they tell you to
create must use all these [DOM] functions". The hook is a thin React
shell over Web APIs. **Don't reach for libraries; they're banned.**

### The canonical skeleton

Every DOM-touching hook has the same shape: subscribe in `useEffect`,
return state, **clean up**. Cleanup is the single thing that gets
plant-bugged: a hook that doesn't remove its listeners leaks across
unmounts, fails their tests.

```ts
function use_hovered_sentence(passage_ref: React.RefObject<HTMLElement>) {
  const [index, set_index] = useState<number | null>(null);

  useEffect(() => {
    const el = passage_ref.current;
    if (!el) return;

    const on_move = (e: MouseEvent) => {
      const pos = (document as any).caretPositionFromPoint?.(e.clientX, e.clientY)
                ?? (document as any).caretRangeFromPoint?.(e.clientX, e.clientY);
      if (!pos) return;
      const node = 'offsetNode' in pos ? pos.offsetNode : pos.startContainer;
      const offset = 'offset' in pos ? pos.offset : pos.startOffset;
      if (node !== el.firstChild) { set_index(null); return; }
      set_index(sentence_index_at_offset(offset));
    };
    const on_leave = () => set_index(null);

    el.addEventListener('mousemove', on_move);
    el.addEventListener('mouseleave', on_leave);
    return () => {
      el.removeEventListener('mousemove', on_move);
      el.removeEventListener('mouseleave', on_leave);
    };
  }, [passage_ref]);

  return index;
}
```

**Decisions:**

- **`caretPositionFromPoint` with `caretRangeFromPoint` fallback.**
  Cross-browser hit-test for text. (LEARN §4.)
- **Confirm the hit node is the text node.** Otherwise the click
  landed on padding, the SVG overlay, or a scrollbar — not on prose.
- **Cleanup returns from `useEffect`.** Non-negotiable.
- **No `useRef` for the listener** — closures over `set_index` are
  fine; React's setter is stable.
- **Dep array is `[passage_ref]`.** The ref object itself is stable;
  this re-runs only if the parent passes a new ref (almost never).
  Do not put `passage_ref.current` in deps — that's a stale-closure
  trap.

### Variants worth pre-loading

**`use_selection()`** — `selectionchange` listener on `document`,
return current selected text + range.

```ts
function use_selection() {
  const [text, set_text] = useState('');
  useEffect(() => {
    const on_change = () => set_text(window.getSelection()?.toString() ?? '');
    document.addEventListener('selectionchange', on_change);
    return () => document.removeEventListener('selectionchange', on_change);
  }, []);
  return text;
}
```

**`use_resize_observer(ref)`** — `ResizeObserver`, return `{ width,
height }`. LEARN §3 already names this; the hook wrapper is two
lines.

**`use_keybinding(code, handler)`** — `keydown` at `window`,
short-circuit if target is `INPUT` or `TEXTAREA`, use `e.code` for
positional shortcuts. LEARN §5.

```ts
function use_keybinding(code: string, handler: (e: KeyboardEvent) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const on_key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      if (e.code !== code) return;
      e.preventDefault();
      ref.current(e);
    };
    window.addEventListener('keydown', on_key);
    return () => window.removeEventListener('keydown', on_key);
  }, [code]);
}
```

**Why the `ref` trick:** the handler closure can change every render,
but you don't want to add/remove the listener every render. Stash
the latest in a ref, read it inside the listener. Standard pattern;
mention it.

### Tie to `LEARN.md`

`use_hovered_sentence` is exactly what `+page.svelte` does with its
`onmousemove` handler, but reshaped as a hook. The work is the same.

### Time budget

15 minutes. Show the skeleton, name the cleanup, explain the deps.
Cleanup and deps are what they grade.

---

## 7. The DSA round — balanced parens + relatives

Mentioned in: 12/4 ("How would you generate a list of all possible
closed `()`, given n?"), 6/2 (data-structure abstract problems).
Round 3.

### What they ask

Classic LeetCode-medium DSA, kept short. The balanced-parens
generator is the named example; expect anything from this cluster:

- Generate all valid parentheses of `n` pairs.
- Validate a parenthesized string.
- Longest valid parentheses substring.
- "Given a tree of nodes, find/sum/flatten X."
- Reservoir sample / debounce-throttle on a stream.

### Balanced parens — full solution

Backtracking. Two counters, two recursive branches, base case.

```ts
function generate_parens(n: number): string[] {
  const out: string[] = [];
  function back(s: string, open: number, close: number): void {
    if (s.length === 2 * n) { out.push(s); return; }
    if (open < n) back(s + '(', open + 1, close);
    if (close < open) back(s + ')', open, close + 1);
  }
  back('', 0, 0);
  return out;
}
```

**Decisions:** the invariant `close < open` is the *only* rule. If
`open < n` you may add `(`; if `close < open` you may add `)`. Both
branches independent, no pruning logic beyond the invariant. The
count is the n-th Catalan number; mention it if asked about
complexity — `O(C(n) · n)` time and output size.

### What to drill, broadly

You're a TS-fluent FE engineer applying for a tech lead role. They
will not throw a hard graph problem at you on a 60-minute clock with
no AI; the page-6/2 review confirms it's "data structures to solve
abstract problems", not DP / advanced graph. Drill:

- Recursion + backtracking (this).
- Tree traversal pre/in/post-order.
- BFS shortest path on a grid.
- Hash-map frequency counting.
- Two-pointer / sliding window on arrays.

**Don't drill** segment trees, KMP, suffix arrays, Dijkstra. Wrong
shape for a 60-minute FE round.

### Time budget

20 minutes per DSA problem in the round. They may give two.

---

## 8. Lightweight system design — search autocomplete

Mentioned in: 10/1 (`Design search autocomplete system`). Could
appear in round 3 if they pivot. Lightweight — it's a 60-minute
round with coding in it, not a 90-minute pure design session.

### What they ask

Sketch an autocomplete: user types, suggestions appear with low
latency, ranked, possibly personalized. They want the FE shape, not
backend sharding.

### The frontend-first answer

```
[input] → debounce(150ms) → in-flight cancellation → fetch /suggest?q=
                                                       ↓
                                                  client-side cache (LRU!)
                                                       ↓
                                                  render dropdown
```

Talk through these knobs in order:

1. **Debounce 150ms.** Below that and you're DOSing the API; above
   and the UX feels laggy. Tune per network.
2. **In-flight cancellation.** Every new keystroke aborts the
   previous request — `AbortController.abort()`. Without it, late
   responses to old queries paint stale suggestions over current
   ones (the "Brad / Bradley" race).
3. **Client-side LRU cache.** Same `LruCache` from §2, keyed by
   query string, TTL ~30s. A user typing "spe" → "spee" → "speech"
   should hit cache when they backspace to "spe".
4. **Server returns sorted candidates.** Don't sort on the client.
   The server has the prefix index (trie or Elasticsearch).
5. **Render: virtualized list if >20 results**, otherwise plain.
   `aria-autocomplete="list"` on the input, results in a
   `role="listbox"`, each item `role="option"`. Keyboard: ArrowUp/
   Down change `aria-activedescendant`; Enter selects.
6. **Performance budget:** keystroke → suggestion paint < 200ms p95.
   The 150ms debounce eats most of it; rendering must be free.

### What they want to hear

The phrase **"in-flight cancellation with `AbortController`"** is the
shibboleth. Drop it early. The phrase **"WAI-ARIA combobox pattern"**
is the second one — accessibility on this widget is hard and a tech
lead is expected to know it exists.

### Tie to `LEARN.md`

Not directly. But the LRU from §2 is reused; the rAF discipline
("don't burn cycles in a hot loop") generalizes to "debounce
expensive work, cancel obsolete work".

### Time budget

15 minutes if it comes up. Sketch on the whiteboard tab, name three
trade-offs, move on.

---

## 9. Leadership & behavioral

Mentioned in: 4/4, 6/2, 7/5, 8/4, 8/5, 9/1, 9/2, 9/4, 11/1, 12/1.
Round 2 — the engineering-leader half-hour. **Recent. Specific. No
philosophy.** The JD says it explicitly.

### The questions you will see

- "What are you looking for in your next role?"
- "Tell me about a time you led a project end-to-end."
- "Walk me through your resume."
- "What's your biggest area of improvement?"
- "Why are you leaving / looking?"
- "What were your responsibilities as a tech lead?"
- "Tell me about a hard technical decision."
- "Tell me about a disagreement with another engineer."

### The STAR shape, but stripped

**Situation, Task, Action, Result** is the framework. The JD's "no
philosophy, only what you did" reduces it to **Situation + Action +
Result**. Skip the task framing; the situation implies it.

A story should fit in 90 seconds:

- 15s: context (which company, when, what was on fire).
- 45s: what *you* specifically did, with verbs and code-level
  detail. Not "we discussed". *Wrote*, *shipped*, *measured*,
  *deprecated*.
- 30s: the outcome with a number if possible (latency, %, headcount,
  weeks).

If a story can't be told this densely, it's not a story, it's a
ramble. Cut it.

### Stories to pre-write

Three stories, written down, drilled out loud:

1. **A technical leadership story.** You picked an approach against
   resistance, shipped it, were right (or wrong and learned).
2. **A delivery story.** Shipped something hard under time
   pressure. Trade-offs you cut, what survived to v1.
3. **A people story.** Mentored, gave hard feedback, resolved a
   disagreement, hired/fired.

Each story should be **load-bearing**: it should be reusable for
3+ of the question types above. "Walk me through your resume" is
just stories #1–3 in order with context glue between them.

### What to *not* say

- "We" without "and my role was X". Recruiters hear "we" as
  passenger.
- "I think the right way to do X is..." That's philosophy. Replace
  with "At [company] in [year] we did X because [reason] and it
  [outcome]."
- "I'm a people person." Show, don't claim.

### "Biggest area of improvement"

The question on page 8/4. The honest answer beats the strategic
answer; interviewers can smell rehearsal. A real weakness, narrated
as a thing you've already noticed and worked on, with a concrete
recent example. **Avoid "perfectionism" / "I work too hard"** — they
will roll their eyes.

### "Why Speechify"

Not in the reviews but inevitable. Three angles, pick the one that's
true:

1. The product is built on the Web API surface you actually enjoy
   working in (point at LEARN.md, half this app is `<audio>` +
   `Range` + `requestAnimationFrame`).
2. Accessibility is the founding story; you want to ship things that
   *matter to someone* not just *to the org chart*.
3. The Chrome extension's "find readable content on every page" is a
   genuinely hard, open problem you'd like to own.

Don't give all three. Pick one, give it crisply, stop talking.

### Time budget

20 minutes of the 60-min round 2. Don't over-prepare and sound
canned; under-preparing and rambling is worse.

---

## 10. The 90 minutes, choreographed

For round 1, the take-home. Reviews say the time pressure is the
single biggest predictor of failure.

```
0:00 – 0:05  Clone, install deps, run tests once. Read the README.
0:05 – 0:10  Read each failing test's name. That is the spec.
0:10 – 0:25  LRU cache (§2). Get it green.
0:25 – 0:55  SSML parser (§1). The hard one. Aim for green by 0:50.
0:55 – 1:15  SSML serializer + decoder (§1). Round-trip first.
1:15 – 1:25  Refactor pass: rename, extract, remove unused.
1:25 – 1:30  Run full test suite, commit, push. Stop. Submit.
```

If you fall behind: **skip the refactor pass and submit green code**.
Tests passing > clean code, every time, in a timed assessment with
no human reviewer in the loop. Reviewers (1/3, 4/2, 7/1) confirm
their tests are how they grade.

### What to set up beforehand

- VS Code with autocomplete **off** (Cmd+Shift+P → "Editor:
  Suggest" → disable). The reviews say predictive completion is
  banned and they screen-record. Configure it now, not at minute
  three.
- A scratch repo with `LruCache` from memory, `parse_ssml` from
  memory, and a test file you can write into in 60 seconds.
  Re-derive them weekly until interview week.
- Node 20+, pnpm, git configured with SSH (JD says: "Set up GitHub
  SSH for cloning").
- Camera and screen recording rehearsed once on a throwaway
  challenge. The reviews repeatedly cite the recording itself as
  the stress; don't let the *first* time you record yourself
  coding be the real interview.

---

## 11. Anti-prep — what *not* to study

Filtered out from the reviews because it doesn't fit the JD:

- **NestJS, Express, Node backend frameworks.** This is a FE role.
  The 2/2 NestJS question was for a different role.
- **Swift / SwiftUI.** 7/5 was the iOS role.
- **Java refactoring.** 5/5 was a Java assessment; you'll be doing
  TS.
- **Python LRU.** Implement in TS. The reviews where Python appeared
  were either backend or "language agnostic" rounds.
- **Job queues, backend system design at scale, sharding,
  distributed consensus.** Not the FE round. If the CEO chat (page
  3 of the JD) wanders here, talk product not infra.
- **Codility-style hard algorithmics** (DP on trees, advanced graph,
  string algorithms beyond two-pointer). The reviews don't surface
  them; the JD's round 3 is "DSA + web parsing", emphasis on web.
- **Whiteboard system design beyond autocomplete-shaped problems.**
  Out of scope for these three rounds.
- **Fullstack repo bug-hunt (the 2/2 Protobuf/Playwright thing).**
  That was a backend-leaning assessment. Yours will be web.

---

## 12. The cheat sheet

If you have 60 seconds before walking in:

- **`findLastIndex(w => w.start <= t)`** — the time→word lookup.
  Cross-applies to any "current item by clock" question.
- **`Range.getClientRects()`** — one rect per line box. The first-
  line-height answer.
- **`caretPositionFromPoint` / `caretRangeFromPoint`** — point→text-
  offset hit-test.
- **`Map` preserves insertion order** — LRU in 8 lines.
- **`AbortController`** — the autocomplete cancellation answer.
- **`ResizeObserver`** — re-measure on layout change.
- **Pre-order traversal with an "inside relevant scope" flag** — the
  decoder shape, reusable for any tree extraction.
- **Cursor `i`, slice on read** — parser without O(n²).
- **`useEffect` returns cleanup** — the React-hook gradable.
- **`e.code` for positional, `e.key` for printed character** — the
  keyboard answer.

Walk in, breathe, narrate, ship.
