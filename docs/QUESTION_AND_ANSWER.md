# Speechify — Tech Lead, Web Core Product & Chrome Extension

Interview Q&A, built from the 56 Glassdoor reviews in `REVIEWS.json`, the
official prep PDF, and the candidate's own grounding in `LEARN.md` /
`LEARN_BY_CODE.md`. Terse on purpose. Use it as a study target.

---

## 1. Role recap

- Team owns **app.speechify.com** and the **Chrome Extension**
  **TTS** (Text-To-Speech) reader. Extension reads **billions of words/month**
  on arbitrary pages.
- The signature hard problem: **detect the readable section** of an
  arbitrary web page (news article vs banking dashboard vs SaaS app).
- Stack signal from the **JD** (Job Description): deep **React** +
  deep **core Web APIs** — `DOM` (the live tree of nodes the browser
  builds from HTML), `Range` (start/end positions inside text nodes),
  `Selection` (what the user has highlighted), Observers
  (`Mutation`/`Resize`/`IntersectionObserver`), events, parsing.
- Loop, per the PDF:
  1. **Web AI Assessment, 90 min** — fill missing functionality in an
     existing repo. AI allowed in some passes (recent reviews) and
     banned in others (older). Assume banned and prep accordingly.
  2. **Live DOM Web APIs, 60 min** — live-code in the browser console.
     Multiple problems, speed matters. Plus leadership questions.
  3. **Coding & Problem Solving, 60 min** — **DSA** (Data Structures
     and Algorithms) + web parsing + Frontend/Browser API foundations.
- 15–30 min closer with CEO **Cliff Weitzman**.

---

## 2. Pattern summary from REVIEWS.json

Reviews kept as web/frontend-relevant: **30**. Discarded as backend /
NestJS / Swift / cloud / process-only complaints / no signal: **26**.

Recurring acronyms in the table below — full definitions inline
where each first matters: **SSML** (XML-for-speech, §3.2), **DOMParser**
(banned string→DOM API, §3.2), **LRU cache** (capacity-evicting K/V,
§3.1), **TTL** (per-entry expiry, §3.1), **Playwright** (Node browser
automation), **Protobuf** (Google's binary wire format).

| Pattern | Hits | Likely round |
|---|---|---|
| **SSML/XML parser, no DOMParser, no libs** (string→tree, tree→string, decode SSML→plain text) | 12 | Assessment + Round 3 |
| **LRU cache with TTL** (sometimes "implement", sometimes "use, don't implement") | 13 | Assessment |
| **TS/JS refactor of an existing repo, tests must pass** | 7 | Assessment |
| **Custom React hook + DOM manipulation under the hood** | 6 | Assessment / Round 2 |
| **"Find top-level readable nodes by parsing HTML"** + **"height of first line of a paragraph from an element"** | 2 explicit + JD theme | Round 2 (DOM live-coding) |
| **Mouse events + DOM traversal** | 3 | Round 2 |
| **Text parser using obscure browser APIs ("no other business uses them")** | 2 | Round 2/3 |
| **Highlight words being read from a phrase** (XML/SSML → display) | 1 explicit + product theme | Assessment |
| **System design / autocomplete / job queue** | 3 | Round 3 |
| **Bug-finding in a fullstack repo (Playwright + Protobuf)** | 1 | Assessment variant |
| Fullstack NestJS module completion | 2 | Assessment (different track) |

The signal is consistent: **a parser and a cache** in the take-home,
**DOM live-coding around text/geometry** in the live round, **DSA +
"how would you parse a real web page"** in the final coding round.

---

## 3. The take-home assessment patterns

### 3.1 LRU cache with TTL

**LRU** (Least Recently Used — fixed-size key/value store that evicts
whichever key was accessed longest ago when full). **TTL** (Time To
Live — each entry also expires after N ms, regardless of recency).
Stacked: two eviction policies, capacity + age.

Multiple reviews say "had tests, just make them pass." Write it from
muscle memory.

```ts
type Entry<V> = { value: V; expires_at: number };

export class LruCache<K, V> {
  private map = new Map<K, Entry<V>>(); // insertion-ordered, that's the whole trick

  constructor(
    private capacity: number,
    private ttl_ms: number,
    private now: () => number = Date.now, // injectable for tests
  ) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expires_at <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // recency: re-insert to move to the tail (most recent)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expires_at: this.now() + this.ttl_ms });
    if (this.map.size > this.capacity) {
      // evict least-recently-used = oldest insertion
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  has(key: K): boolean {
    return this.get(key) !== undefined; // funnel through get so TTL eviction runs
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }
}
```

Gotchas the test suite will probe:
- `get` on an expired key must return `undefined` AND remove the entry.
- `set` on an existing key must refresh recency AND reset the TTL — confirm
  which one they want; both are defensible. Default to "both."
- Capacity 0 — define behavior (cache disabled vs throw).
- Setting an entry that immediately exceeds capacity: evict before
  inserting? After? `Map` insertion order means our pattern is "insert,
  then evict oldest" which is consistent and easy to reason about.
- Time source: take a `now` injection. Tests use fake timers.

If they say **"use an LRU cache but don't implement it"**, treat it as
an interface contract problem. Wrap a hypothetical `Cache<K,V>` and
demonstrate how you'd memoize a fetcher or stream parser around it.

### 3.2 SSML / XML parser without DOMParser

The most-repeated single question in the dataset. Three concrete asks:
**string → node tree**, **node tree → string**, **decode to plain text**.
You write a **recursive-descent parser** by hand: a small state
machine with an index `i` walking the input, plus a stack tracking
which element you're currently inside.

SSML is a subset of XML — for the take-home, support `<speak>`, `<p>`,
`<s>` (sentence), `<break>`, `<prosody>`, `<say-as>`. Tag names may
contain `-`. Attributes are double-quoted. Self-closing tags exist
(`<break time="500ms" />`). **Entities** are escapes like `&amp;`,
`&lt;`, `&gt;`, `&quot;`, `&apos;` that stand in for reserved
characters; **CDATA** (`<![CDATA[…]]>`) is an XML literal-text block
the parser must pass through verbatim.

```ts
export type SsmlNode =
  | { type: "text"; value: string }
  | { type: "element"; name: string; attrs: Record<string, string>; children: SsmlNode[] };

export function parse_ssml(input: string): SsmlNode {
  let i = 0;
  const root: SsmlNode = { type: "element", name: "#root", attrs: {}, children: [] };
  const stack: SsmlNode[] = [root];

  const peek = (n = 0) => input[i + n];
  const eat = (s: string) => {
    if (input.slice(i, i + s.length) !== s) throw new Error(`expected ${s} at ${i}`);
    i += s.length;
  };
  const skip_ws = () => { while (i < input.length && /\s/.test(input[i])) i++; };

  const read_name = () => {
    const start = i;
    while (i < input.length && /[A-Za-z0-9_\-:]/.test(input[i])) i++;
    return input.slice(start, i);
  };

  const read_attrs = (): Record<string, string> => {
    const attrs: Record<string, string> = {};
    while (true) {
      skip_ws();
      if (peek() === "/" || peek() === ">") return attrs;
      const name = read_name();
      if (!name) return attrs;
      eat("=");
      const quote = input[i++];
      if (quote !== '"' && quote !== "'") throw new Error("attr quote");
      const start = i;
      while (i < input.length && input[i] !== quote) i++;
      attrs[name] = decode_entities(input.slice(start, i));
      i++; // closing quote
    }
  };

  while (i < input.length) {
    if (peek() === "<") {
      if (input.startsWith("<!--", i)) {
        const end = input.indexOf("-->", i + 4);
        i = end < 0 ? input.length : end + 3;
        continue;
      }
      if (peek(1) === "/") {
        i += 2;
        const name = read_name();
        skip_ws(); eat(">");
        const top = stack.pop();
        if (!top || top.type !== "element" || top.name !== name) {
          throw new Error(`mismatched </${name}>`);
        }
        continue;
      }
      i++; // consume '<'
      const name = read_name();
      const attrs = read_attrs();
      skip_ws();
      const self_closing = peek() === "/";
      if (self_closing) i++;
      eat(">");
      const node: SsmlNode = { type: "element", name, attrs, children: [] };
      (stack[stack.length - 1] as Extract<SsmlNode, { type: "element" }>).children.push(node);
      if (!self_closing) stack.push(node);
    } else {
      const start = i;
      while (i < input.length && input[i] !== "<") i++;
      const text = decode_entities(input.slice(start, i));
      if (text) {
        (stack[stack.length - 1] as Extract<SsmlNode, { type: "element" }>)
          .children.push({ type: "text", value: text });
      }
    }
  }

  if (stack.length !== 1) throw new Error("unclosed elements");
  // unwrap #root if there's exactly one element child
  const kids = (root as Extract<SsmlNode, { type: "element" }>).children;
  return kids.length === 1 && kids[0].type === "element" ? kids[0] : root;
}

function decode_entities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&"); // amp last so we don't re-decode
}
```

Serialize back:

```ts
export function serialize_ssml(node: SsmlNode): string {
  if (node.type === "text") return encode_entities(node.value);
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${encode_entities(v)}"`).join("");
  if (node.children.length === 0) return `<${node.name}${attrs}/>`;
  const inner = node.children.map(serialize_ssml).join("");
  return `<${node.name}${attrs}>${inner}</${node.name}>`;
}

function encode_entities(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
```

Decode to plain text — strip wrappers, keep `<s>` (sentence) text,
respect `<break>` as a space, drop `<say-as interpret-as="…">`
formatting by emitting the raw text:

```ts
export function ssml_to_text(node: SsmlNode): string {
  if (node.type === "text") return node.value;
  if (node.name === "break") return " ";
  return node.children.map(ssml_to_text).join("");
}

// "extract text solely from <s> sentence elements":
export function extract_sentences(node: SsmlNode): string[] {
  const out: string[] = [];
  const walk = (n: SsmlNode) => {
    if (n.type === "element") {
      if (n.name === "s") out.push(ssml_to_text(n).trim());
      else n.children.forEach(walk);
    }
  };
  walk(node);
  return out;
}
```

Gotchas the reviews flagged:
- **Strip invalid wrappers.** If `<speak>` contains stray garbage at the
  top level, drop it. Decide policy: throw vs ignore. Tests will pick.
- **Their test cases may not be valid XML.** One reviewer noted `< speech >`
  with spaces between `<` and the tag. Be defensive in `read_name`:
  call `skip_ws` after `<` if the test fixtures look loose.
- **Whitespace handling.** Decide whether to collapse `\s+` inside `<s>`.
  XML says no, SSML rendering says yes. Ask in a comment; pick one.
- **Entities.** At minimum decode the five named ones. Numeric (`&#65;`,
  `&#x41;`) is bonus and easy.
- **Self-closing.** `<break/>` is valid; so is `<break />` with space.
- **Comments and CDATA.** Comments: skip. CDATA: rarely tested but
  `<![CDATA[…]]>` literal-text-pass-through is one regex.

### 3.3 Refactor an existing TS/JS file, tests must pass

Reviews complain the existing code is intentionally bad and time is
tight. The pattern across reviewers:
- Read the failing tests **first**. They are the spec.
- Identify the seams (function boundaries) and the one type that
  should exist but doesn't.
- Don't golf. Don't change public signatures unless the tests demand it.
- Common smells they plant: mutation through aliased state, missing
  early returns, copy-pasted branches that should be a lookup table,
  hand-rolled deep-equal, missing `try/catch` around `JSON.parse`,
  array methods misused (`forEach` returning, `reduce` with mutating
  accumulator).

Typical before/after — collapse nested branches into a lookup + early returns:

```ts
// before: nested ifs, mutation, copy-pasted branches
function format(kind: string, n: number) {
  let out = "";
  if (kind === "usd") { if (n < 0) out = "-$" + (-n); else out = "$" + n; }
  else if (kind === "eur") { if (n < 0) out = "-€" + (-n); else out = "€" + n; }
  return out;
}

// after: pure, table-driven, early return
const SYMBOL: Record<string, string> = { usd: "$", eur: "€" };
function format(kind: string, n: number): string {
  const sym = SYMBOL[kind];
  if (!sym) throw new Error(`unknown currency ${kind}`);
  return n < 0 ? `-${sym}${-n}` : `${sym}${n}`;
}
```

### 3.4 Bug hunt in fullstack repo (Playwright + Protobuf)

One reviewer, but worth a note. Bring AI if allowed. If not: clone,
`grep -r TODO`, run tests, read failing assertions. Don't read the
whole repo top-down; let the failing tests pull you in.

Classic shape — an async handler that forgets to return the promise, so
the caller resolves before the work finishes:

```ts
// bug: route resolves before save completes; client races the read
app.post("/items", async (req, res) => {
  db.save(req.body).then((row) => res.json(row)); // not awaited, not returned
});

// fix: await, propagate errors, register cleanup
app.post("/items", async (req, res, next) => {
  try {
    const row = await db.save(req.body);
    res.json(row);
  } catch (err) { next(err); }
});
```

---

## 4. The DOM live-coding round (the round the JD is really about)

This is where the candidate's `LEARN_BY_CODE.md` toolkit earns its
keep. Reviewers report **mouse events + DOM traversal**, a **text
parser using browser APIs**, **"find top-level readable nodes by
parsing HTML"**, and **"get the height of the first line of a
paragraph from an element."** Those are extension-team problems.

### 4.1 "Get the height of the first line of a paragraph from an element"

Explicit ask in the reviews. The candidate already knows the trick
from §3 of `LEARN_BY_CODE.md` — `Range.getClientRects()`.

**Range** — built-in browser object representing a `{startContainer,
startOffset, endContainer, endOffset}` span inside the DOM.
**`getClientRects()`** returns one `DOMRect` per line box that span
covers, in viewport pixel coordinates. That's what lets you draw a
highlight without wrapping the text in `<span>`s.

```ts
function first_line_height(el: HTMLElement): number {
  const text = el.firstChild;
  if (!text || text.nodeType !== Node.TEXT_NODE) return 0;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, text.textContent!.length);
  const rects = range.getClientRects();
  return rects.length ? rects[0].height : 0;
}
```

Probes:
- "What if there's a nested `<strong>` in the paragraph?" — walk to the
  first text node via a **`TreeWalker`** (built-in DOM iterator that
  yields every node matching a `NodeFilter`, depth-first), not
  `firstChild`.
- "What about line-height vs the rect height?" — `getClientRects` gives
  you the **line box** the glyphs sit in. That is what you want for
  highlighting. `getComputedStyle(el).lineHeight` gives you the CSS,
  which is not the same number when fonts have descenders or when
  `line-height: normal` is used.
- "What if the element hasn't laid out yet?" — `getClientRects` forces
  layout. Cheap, but in a tight loop, measure once and cache.

### 4.2 "Find top-level readable nodes by parsing HTML"

This is **Mozilla Readability**-lite — Readability is the open-source
algorithm Firefox's Reader View uses to score every element on a page
and pick the "main article" container. The extension has to do this
on every page. Live-code the heuristic.

```ts
function find_readable_roots(root: HTMLElement = document.body): HTMLElement[] {
  const candidates: { el: HTMLElement; score: number }[] = [];
  const BLOCK = new Set(["ARTICLE", "MAIN", "SECTION", "DIV", "P"]);
  const NEGATIVE = /comment|sidebar|footer|header|nav|menu|ad-|promo|share|social/i;
  const POSITIVE = /article|content|main|body|entry|post|story/i;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode() as HTMLElement | null; n; n = walker.nextNode() as HTMLElement | null) {
    if (!BLOCK.has(n.tagName)) continue;
    const text_len = (n.textContent ?? "").trim().length;
    if (text_len < 140) continue; // arbitrary floor, tune
    const link_text = Array.from(n.querySelectorAll("a"))
      .reduce((sum, a) => sum + (a.textContent ?? "").length, 0);
    const link_density = link_text / text_len;
    if (link_density > 0.5) continue; // nav, not prose
    const p_count = n.querySelectorAll("p").length;
    const commas = (n.textContent!.match(/,/g) ?? []).length;
    let score = text_len / 100 + p_count * 3 + commas;
    const id_class = `${n.id} ${n.className}`;
    if (NEGATIVE.test(id_class)) score -= 25;
    if (POSITIVE.test(id_class)) score += 25;
    if (n.tagName === "ARTICLE") score += 30;
    if (n.tagName === "MAIN") score += 20;
    candidates.push({ el: n, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  // collapse: drop any candidate that's an ancestor or descendant of a higher-scored one
  const picked: HTMLElement[] = [];
  for (const c of candidates) {
    if (picked.some(p => p.contains(c.el) || c.el.contains(p))) continue;
    picked.push(c.el);
  }
  return picked.slice(0, 5);
}
```

Probes:
- "Why text length and comma count?" — Readability's empirical signal.
  Prose has commas and length; nav and chrome don't.
- "Why link density?" — separates "list of links" (nav, related
  articles) from "prose with the occasional link" (article body).
- "How would you handle SPAs that mutate after load?" — **SPA**
  (Single-Page App) means the page rewrites itself client-side
  instead of full-page-reloading. Use **`MutationObserver`** (a
  built-in DOM API that fires a callback whenever child nodes,
  attributes, or text data change under a target) on `document.body`
  with a debounced re-run. Tie into §4.4.
- "Banking app vs news article?" — banking has short labels, button
  text, no commas, dense links. Heuristic naturally rejects them.
  Add a cap on `display: none` / `visibility: hidden` ancestors.
- "Shadow DOM?" — **Shadow DOM** is a subtree of nodes attached to a
  host element that is isolated from the main document tree (styles
  don't leak in or out, `querySelector` from outside can't see in).
  `TreeWalker` doesn't cross shadow roots. You'd recurse into
  `el.shadowRoot` when present; many design systems use **closed**
  shadow roots (`mode: "closed"` hides `shadowRoot` from outside JS)
  and you can't reach in.

### 4.3 Click-to-read on an arbitrary page

The extension's actual UX. Candidate has this in §4 of
`LEARN_BY_CODE.md` (**`caretPositionFromPoint`** — browser API that
maps a pixel coordinate, e.g. a mouse click, back to a `{offsetNode,
offset}` pair inside the DOM text — plus sentence hit-test). For the
extension version:

```ts
document.addEventListener("click", (e) => {
  const pos = (document as any).caretPositionFromPoint?.(e.clientX, e.clientY)
    ?? caretRangeFromPoint_fallback(e.clientX, e.clientY);
  if (!pos) return;
  const node = pos.offsetNode ?? pos.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;
  // walk up to the readable root, find the sentence around `pos.offset`
}, { capture: true });
```

Probes:
- "Safari?" — older Safari needs `caretRangeFromPoint`. Detect both.
- "How do you avoid hijacking real links?" — let click through if the
  target is inside an `<a>` or `<button>`, or use `capture: true` only
  on a modifier key.

### 4.4 Watching pages that mutate

`MutationObserver`. Probes will ask about config and perf.

```ts
const obs = new MutationObserver((records) => {
  for (const r of records) {
    if (r.type === "childList" && r.addedNodes.length) {
      // debounced re-scan of readable roots
    }
  }
});
obs.observe(document.body, { childList: true, subtree: true, characterData: false });
```

Probes:
- "Why not `characterData: true`?" — fires on every typing keystroke in
  contenteditable. We don't need it for readable-root detection.
- "How do you avoid feedback loops when you inject UI?" — wrap your
  injection inside a `disconnect()` / `observe()` pair, or namespace
  your inserted nodes with a data attribute and ignore them in the
  callback.

### 4.5 Visibility-based prefetch / lazy work

**`IntersectionObserver`** (browser API that fires a callback when a
target element enters or leaves a configurable viewport region; built
for lazy-loading and viewport tracking without scroll listeners) for
"is this sentence on screen, prefetch its audio." Candidate already
knows the API shape via **`ResizeObserver`** (analogous API that fires
when an element's box dimensions change, including from internal
layout shifts, not just window resize) in §3 of `LEARN_BY_CODE.md`.

```ts
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const id = (e.target as HTMLElement).dataset.sentenceId!;
    prefetch_audio(id); // your cached fetch
    io.unobserve(e.target); // one-shot
  }
}, { rootMargin: "200px 0px", threshold: 0.01 });

for (const s of document.querySelectorAll<HTMLElement>("[data-sentence-id]")) {
  io.observe(s);
}
```

### 4.6 Selection API for "play this paragraph"

**Selection API** — `document.getSelection()` returns a `Selection`
object representing whatever the user has highlighted with cursor or
touch. It exposes one or more `Range` objects covering the highlighted
text. Already named as a follow-up in §4 of `LEARN.md`. Recap of the
live sequence:

```ts
const sel = document.getSelection();
if (!sel || sel.rangeCount === 0) return;
const range = sel.getRangeAt(0);
// range.startContainer, range.startOffset → map to your char index
// range.toString() is the selected text, useful for TTS input
```

Probes:
- "`selectionchange` event quirks?" — fires on the `document`, not on
  elements. Throttle.
- "Cross-element selections?" — `range.cloneContents()` returns a
  `DocumentFragment`; for plain text just `range.toString()`.

---

## 5. Round 3 — DSA, problem solving, web parsing

The JD names it as DSA + Frontend foundations. Drill these:

- **Binary search variants** — classic O(log n) lookup in a sorted
  array: halve the search range each step by comparing the midpoint
  with the target. The variant here is "largest index `i` such that
  `arr[i] ≤ t`", which is exactly what the candidate already knows
  from the audio sync loop in §2 of `LEARN.md`. Same template solves
  "find first sentence whose start ≥ scroll Y", "find first cache
  entry not yet expired."
- **Sliding window** — algorithm pattern where two pointers (`lo`,
  `hi`) walk over a sequence maintaining a running aggregate
  (count/sum/max). Used here for readability scoring, debounced
  telemetry, rate-limited TTS requests.
- **Trie / autocomplete** — a **trie** is a tree where each edge is
  one character and each path from root spells a stored string;
  perfect for prefix lookup. One reviewer reports "design search
  autocomplete system." Hash-trie keyed on prefix, with TTL'd
  cache (tie back to 3.1) for ranked results.
- **Job queue** — a **concurrency-limited promise queue** runs at
  most N async tasks at a time and parks the rest until a slot frees
  up. One reviewer. Worth memorizing:

```ts
function pqueue<T>(limit: number) {
  let active = 0;
  const waiters: (() => void)[] = [];
  const acquire = () => new Promise<void>((res) => {
    if (active < limit) { active++; res(); } else waiters.push(() => { active++; res(); });
  });
  const release = () => { active--; waiters.shift()?.(); };
  return async (fn: () => Promise<T>) => {
    await acquire();
    try { return await fn(); } finally { release(); }
  };
}
```

- **Event-loop / microtasks** — JS runs one **task** at a time (a
  macrotask: a `setTimeout` callback, an event handler, etc.).
  Between tasks the engine drains the **microtask** queue
  (`Promise.then`, `queueMicrotask`) to completion, then paints
  (firing `rAF` callbacks just before paint). Likely probe.
  `queueMicrotask` vs `setTimeout(0)` vs `requestAnimationFrame`.
  Candidate already lives this distinction in §2 of `LEARN.md`.
- **Debounce / throttle** — both rate-limit a function. **Debounce**
  waits until `ms` have elapsed since the *last* call before firing
  (good for "fire after the user stops typing"). **Throttle** fires
  at most once per `ms` window regardless of call rate (good for
  scroll/resize handlers). Write both from scratch. They're trivial,
  but interviewers want to see leading vs trailing edge correctness.

---

## 6. Chrome extension specifics (inference from JD, not reviews)

Reviews don't probe the manifest; the JD does. Be ready for any of:

- **Manifest v3 (MV3).** The current Chrome extension manifest
  version, mandatory for new submissions. Background code runs as a
  **service worker** (SW) — a background script the browser keeps
  alive separately from the page, intercepting network requests for
  offline support and caching. In extensions the SW replaces the old
  persistent background page: it sleeps when idle and wakes on
  events. Use `chrome.storage.local` for any state that must survive
  the worker dying.
- **Content scripts vs background.** A **content script** is JS that
  the extension injects into matching pages and that runs *with* the
  page's DOM. It runs in an **isolated world** — same DOM, separate
  JS heap from the page's scripts. Can't see page globals; the page
  can't see your variables. Communication:
  `chrome.runtime.sendMessage` to background, `window.postMessage`
  + page-world script for talking to page JS.
- **Injecting UI** without breaking the host page: prefer **Shadow DOM**
  (subtree attached to a host element, isolated from outer styles)
  to isolate styles. Build the reader UI inside a
  `host.attachShadow({ mode: "closed" })` and inline styles inside.
  Otherwise host-page CSS will eat your layout.
- **Selection API on arbitrary pages** — `document.getSelection()`
  works fine from a content script. Works inside the host page's DOM,
  not inside your shadow-rooted UI (separate selection contexts).
- **Permissions.** `host_permissions` for the origins you read,
  `activeTab` for click-to-activate. Reviewer-side privacy concern.
- **Audio playback in extensions.** From the content script: just
  create an `<audio>` and play it. From the background SW: SWs can't
  play audio directly in MV3 — route through `chrome.offscreen` API
  (offscreen document with `<audio>`), or play in the content script.
- **Inference, not from reviews:** the team almost certainly has a
  "should we activate on this page?" heuristic that's identical to
  §4.2 above. Ready to be asked.

Minimal MV3 manifest:

```json
{
  "manifest_version": 3,
  "name": "Speechify Reader",
  "version": "1.0.0",
  "permissions": ["activeTab", "storage", "offscreen"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "bg.js", "type": "module" },
  "content_scripts": [{ "matches": ["<all_urls>"], "js": ["content.js"], "run_at": "document_idle" }],
  "action": { "default_title": "Read this page" }
}
```

Content script ↔ background message exchange:

```ts
// content.ts
const res = await chrome.runtime.sendMessage({ type: "tts", text: "hello world" });
console.log(res.audio_url);

// bg.ts (service worker)
chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg.type !== "tts") return;
  fetch("/synth", { method: "POST", body: JSON.stringify({ text: msg.text }) })
    .then((r) => r.json()).then((j) => send({ audio_url: j.url }));
  return true; // keep channel open for async send
});
```

Shadow-root UI injection that survives host CSS:

```ts
const host = document.createElement("div");
host.dataset.speechify = "ui";
document.body.appendChild(host);
const shadow = host.attachShadow({ mode: "closed" });
const style = document.createElement("style");
style.textContent = `:host{all:initial} .bar{position:fixed;bottom:16px;right:16px;padding:8px;background:#111;color:#fff;font:14px system-ui}`;
shadow.append(style, Object.assign(document.createElement("div"), { className: "bar", textContent: "Play" }));
```

---

## 7. Drill list before the loop

Confirmed by reviews — practice until typeable in under 15 min each:

- LRU + TTL cache, with the tests for "set updates recency", "get on
  expired removes", "eviction order under interleaved ops."
- SSML/XML parser (string → tree, tree → string, tree → plain text,
  extract `<s>` sentence text). With the loose-whitespace quirks.
- Refactor a 100-line mess against a fixed test file. Practice the
  read-tests-first flow.
- Live-code in the **console** with no IDE, no autocomplete: write
  `find_readable_roots`, `first_line_height`, a `MutationObserver`,
  debounce, binary search.
- `Range.getClientRects()` from scratch into a positioned overlay.
- One round of "Walk me through your reader" using §10 of `LEARN.md`
  as the script.

---

## 8. Q&A index (interview-shaped)

For each, the answer is one paragraph plus a reference into the
candidate's own notes. The candidate should expand live, not recite.

### Q1. "Write an SSML parser without DOMParser."
**SSML** (Speech Synthesis Markup Language — XML dialect with `<speak>`,
`<s>`, `<break>` that tells a TTS engine how to read text).
**DOMParser** (`new DOMParser().parseFromString(str, "text/xml")` — the
built-in string→DOM API; banned to force you to hand-roll tokenizer +
tree builder). See §3.2 above. Recursive-descent tokenizer with a
stack. Decode the five named entities. Be loose on whitespace inside
tags because their test fixtures are. Decode-to-text is a separate
walk that treats `<break>` as space and unwraps everything else.

```ts
// minimal: tag-or-text scanner, no attrs, for whiteboard speed
type N = { tag: string; kids: (N | string)[] };
function parse(s: string): N {
  const stack: N[] = [{ tag: "#root", kids: [] }];
  const re = /<\/?([a-z][\w-]*)\s*\/?>|([^<]+)/gi;
  for (const m of s.matchAll(re)) {
    const top = stack.at(-1)!;
    if (m[2]) { top.kids.push(m[2]); continue; }
    const closing = m[0][1] === "/", self = m[0].endsWith("/>");
    if (closing) { stack.pop(); continue; }
    const node = { tag: m[1], kids: [] };
    top.kids.push(node);
    if (!self) stack.push(node);
  }
  return stack[0];
}
```

### Q2. "Implement an LRU cache with TTL."
**LRU** (Least Recently Used — fixed-size key/value store that evicts
whichever key was accessed longest ago when full). **TTL** (Time To
Live — each entry also expires after N ms, even if it was just
inserted; two eviction policies stacked: capacity + age). See §3.1.
`Map` is insertion-ordered; that's the whole structure. `get`
delete-then-set to bump recency. `set` evicts oldest after insert when
over capacity. Inject `now` for tests. Discuss "does set refresh TTL"
and "what's get-on-expired's return value" up front.

```ts
// console-sized version
const lru = <K, V>(cap: number, ttl: number) => {
  const m = new Map<K, { v: V; exp: number }>();
  return {
    get(k: K) {
      const e = m.get(k);
      if (!e) return;
      if (e.exp <= Date.now()) { m.delete(k); return; }
      m.delete(k); m.set(k, e);
      return e.v;
    },
    set(k: K, v: V) {
      m.delete(k);
      m.set(k, { v, exp: Date.now() + ttl });
      if (m.size > cap) m.delete(m.keys().next().value!);
    },
  };
};
```

### Q3. "Get the height of the first line of a paragraph."
**`Range`** (built-in browser object representing a start/end position
inside text nodes; `getClientRects()` returns one `DOMRect` per line
box). See §4.1. `Range` over the first text node, `getClientRects()[0].height`.
Same trick as `LEARN_BY_CODE.md` §5. Mention that this is the **line
box** height, not `line-height`, and that the two diverge with
descenders or `line-height: normal`.

```ts
function firstLineHeight(p: HTMLElement): number {
  const tw = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  const text = tw.nextNode() as Text | null;
  if (!text) return 0;
  const r = document.createRange();
  r.setStart(text, 0); r.setEnd(text, text.data.length);
  return r.getClientRects()[0]?.height ?? 0;
}
```

### Q4. "Find the readable nodes in this page."
See §4.2. Mozilla Readability-style heuristic. Length, comma count,
paragraph count, link density, class/id regex. Collapse
ancestor/descendant duplicates. Cap at top-N.

```ts
function readable(root: HTMLElement = document.body): HTMLElement[] {
  const score = (el: HTMLElement) => {
    const txt = (el.textContent ?? "").trim();
    if (txt.length < 140) return -1;
    const links = [...el.querySelectorAll("a")].reduce((s, a) => s + (a.textContent?.length ?? 0), 0);
    if (links / txt.length > 0.5) return -1;
    return txt.length / 100 + el.querySelectorAll("p").length * 3 + (txt.match(/,/g)?.length ?? 0);
  };
  const ranked = [...root.querySelectorAll<HTMLElement>("article,main,section,div,p")]
    .map((el) => ({ el, s: score(el) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  const out: HTMLElement[] = [];
  for (const { el } of ranked) if (!out.some((p) => p.contains(el) || el.contains(p))) out.push(el);
  return out.slice(0, 5);
}
```

### Q5. "Sync a highlight with audio playback."
Candidate's §2 of `LEARN.md`. `<audio>` + `rAF` (`requestAnimationFrame`,
once-per-paint callback) + `findLastIndex` with `start ≤ t` semantics.
Not `timeupdate` (the `<audio>` element's built-in event fires only
~4 times per second, too coarse for word-level highlighting). Bias
early 60–100 ms for output latency. Binary search past 1k words.

```ts
const audio = document.querySelector("audio")!;
const words: { start: number; el: HTMLElement }[] = [];
const LEAD = 0.08;
function tick() {
  const t = audio.currentTime - LEAD;
  const i = words.findLastIndex((w) => w.start <= t);
  if (i >= 0) words[i].el.classList.add("active");
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
```

### Q6. "Click a paragraph, start reading from there."
Candidate's §4 of `LEARN.md`. `caretPositionFromPoint` →
`{ offsetNode, offset }` → confirm it's the prose text node → map
offset to sentence index → `audio.currentTime = sentence.start`.
`caretRangeFromPoint` fallback for older Safari.

```ts
document.addEventListener("click", (e) => {
  const doc = document as any;
  const hit = doc.caretPositionFromPoint?.(e.clientX, e.clientY)
    ?? doc.caretRangeFromPoint?.(e.clientX, e.clientY);
  if (!hit) return;
  const node: Node = hit.offsetNode ?? hit.startContainer;
  const offset: number = hit.offset ?? hit.startOffset;
  if (node.nodeType !== Node.TEXT_NODE) return;
  const s = sentenceFor(node, offset); // your index lookup
  if (s) audio.currentTime = s.start;
});
```

### Q7. "Highlight without wrapping the text in spans."
Candidate's §3 of `LEARN.md`. `Range.getClientRects()` into an
`aria-hidden` SVG overlay with `<rect rx ry>` (rounded-corner SVG
rectangles painted over the text). Single text node, prose intact
for reader-mode, **AT** (Assistive Technology — screen readers,
braille displays, switch controls), and Select-All. The **CSS
Custom Highlight API** (`CSS.highlights` + `::highlight(name)`
pseudo-element styling a `Range`) is the alternative when flat
rects suffice.

```ts
function paintHighlight(text: Text, start: number, end: number, svg: SVGSVGElement) {
  const r = document.createRange();
  r.setStart(text, start); r.setEnd(text, end);
  const host = svg.getBoundingClientRect();
  svg.replaceChildren();
  for (const rect of r.getClientRects()) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    el.setAttribute("x", String(rect.x - host.x));
    el.setAttribute("y", String(rect.y - host.y));
    el.setAttribute("width", String(rect.width));
    el.setAttribute("height", String(rect.height));
    el.setAttribute("rx", "2"); el.setAttribute("fill", "yellow");
    svg.appendChild(el);
  }
}
```

### Q8. "Layout shifts — viewport, font load, reflow. How do you keep
the overlay correct?"
**Reflow** is the browser recomputing positions and sizes of every
affected box after a DOM/style change (expensive — triggered by
inserting nodes, changing dimensions, or reading layout-affecting
properties like `offsetTop` in the same frame as a write). Candidate's
§3 of `LEARN.md`. `ResizeObserver` on the passage wrapper, write the
rect into reactive state, derived consumers recompute naturally.
Fires on internal layout shifts too, not just viewport.

```ts
const ro = new ResizeObserver((entries) => {
  for (const e of entries) repaintOverlay(e.target as HTMLElement);
});
ro.observe(passageEl);
document.fonts.ready.then(() => repaintOverlay(passageEl)); // late font swap
```

### Q9. "Watch a page for new readable content."
**`MutationObserver`** (DOM API that fires a callback whenever child
nodes, attributes, or text data change under a target). §4.4 above.
`MutationObserver` with `childList: true, subtree: true`, debounced.
Disconnect/reobserve around your own injections, or filter by a
data-attribute namespace.

```ts
let timer: ReturnType<typeof setTimeout> | null = null;
const mo = new MutationObserver((recs) => {
  if (recs.every((r) => [...r.addedNodes].every((n) => (n as HTMLElement).dataset?.speechify))) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(rescan, 250);
});
mo.observe(document.body, { childList: true, subtree: true });
```

### Q10. "OS-level media controls."
**MediaSession API** — `navigator.mediaSession` tells the OS what's
playing so the lock screen, keyboard media keys, Bluetooth headsets,
and AirPods can control your `<audio>`. Candidate's §6 of `LEARN.md`.
`setActionHandler` for play/pause/seek. `MediaMetadata` for the
lock-screen label. `setPositionState` on
`play`/`pause`/`seeked`/`ratechange`/`loadedmetadata`, wrapped in
`try/catch` because Chromium throws on `NaN` duration. Feature-detect;
graceful no-op when absent.

```ts
const ms = navigator.mediaSession;
if (ms) {
  ms.metadata = new MediaMetadata({ title: "Chapter 1", artist: "Speechify" });
  ms.setActionHandler("play", () => audio.play());
  ms.setActionHandler("pause", () => audio.pause());
  ms.setActionHandler("seekto", (d) => { if (d.seekTime != null) audio.currentTime = d.seekTime; });
  audio.addEventListener("loadedmetadata", () => {
    try { ms.setPositionState({ duration: audio.duration, position: audio.currentTime, playbackRate: audio.playbackRate }); }
    catch {}
  });
}
```

### Q11. "Where do you persist the reader state?"
Candidate's §7 of `LEARN.md`. **`localStorage`** — synchronous
origin-scoped key/value store (~5 MB, strings only) — written on
`pagehide` (the modern "page is going away" event; preferred over
`beforeunload` because the latter blocks bfcache), read on mount
inside the playback `$effect` (Svelte reactive effect), wrapped in
`try/catch`. **IndexedDB** (async transactional database in the
browser, good for blobs and structured data) only when blobs or
structured app state earn it.

```ts
const KEY = "reader:state";
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; } };
addEventListener("pagehide", () => {
  try { localStorage.setItem(KEY, JSON.stringify({ t: audio.currentTime, src: audio.src })); } catch {}
});
const saved = load();
if (saved?.src === audio.src) audio.currentTime = saved.t;
```

### Q12. "Back/forward cache."
**bfcache** — Back/Forward cache: the browser keeps the whole page in
memory when you navigate away so back/forward is instant.
`pageshow` with `event.persisted === true` means a bfcache restore,
not a fresh load. Candidate's §7 of `LEARN.md`. State is already
alive; the hook exists for "re-validate this token" cases the reader
doesn't have yet.

```ts
addEventListener("pageshow", (e) => {
  if (!e.persisted) return; // fresh load, nothing to do
  revalidateAuthToken(); // or refresh server-driven state
});
```

### Q13. "Implement debounce."
```ts
function debounce<F extends (...a: any[]) => void>(fn: F, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<F>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  };
}
```
Probe: trailing-edge vs leading-edge. The above is trailing. Leading:
fire immediately if `t === null`, then debounce subsequent calls.

### Q14. "Binary search the active word."
Candidate's §2 of `LEARN.md`. Binary search is the O(log n) lookup in
a sorted array — halve the range at each step. The variant here is
"largest index `i` such that `words[i].start ≤ t`." `lo`/`hi`,
midpoint check, `lo - 1` at the end. Same template the candidate
already memorized.

```ts
function lastIndexLE(words: { start: number }[], t: number): number {
  let lo = 0, hi = words.length; // half-open
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (words[mid].start <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1; // -1 means "before first word"
}
```

### Q15. "Design a job queue."
§5 above. Counter + waiter queue. `acquire`/`release` around the
user-provided async fn.

```ts
function queue(limit: number) {
  let active = 0;
  const waiters: (() => void)[] = [];
  const next = () => { active--; waiters.shift()?.(); };
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((r) => waiters.push(r));
    active++;
    try { return await fn(); } finally { next(); }
  };
}
const run = queue(3);
await Promise.all(urls.map((u) => run(() => fetch(u))));
```

### Q16. "Design search autocomplete."
Trie keyed on prefix; each node stores top-K results (small heap or
sorted array). Client-side LRU+TTL cache (Q2!) keyed on the query
string. Debounce input (Q13). On the server, prefix-search over a
ranked index. Discuss cancellation: **`AbortController`** — built-in
API whose `.signal` you pass into `fetch`; calling `.abort()` cancels
the in-flight request — fire on each new keystroke so the older
request supersedes.

```ts
type Node = { kids: Map<string, Node>; top: string[] };
const root: Node = { kids: new Map(), top: [] };
function insert(word: string, all: string[]) {
  let n = root;
  for (const ch of word) {
    let k = n.kids.get(ch);
    if (!k) { k = { kids: new Map(), top: [] }; n.kids.set(ch, k); }
    n = k; n.top = all.slice(0, 10);
  }
}
let ac: AbortController | null = null;
async function search(q: string) {
  ac?.abort(); ac = new AbortController();
  const r = await fetch(`/ac?q=${q}`, { signal: ac.signal });
  return r.json();
}
```

### Q17. "Refactor this file in 30 minutes."
Process: read tests first. Run them. Identify the smallest change
that flips one test green. Iterate. Don't widen public signatures.
Don't add features. Stop the second the suite is green.

```ts
// example "smallest change": guarded JSON parse around an external boundary
function loadConfig(raw: string): Config {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    return parsed as Config;
  } catch (err) {
    throw new Error(`bad config: ${(err as Error).message}`);
  }
}
```

### Q18. "Chrome extension: how do you read text from a page the
content script is injected into?"
§6 above. Content script in isolated world, full DOM access. Use the
readable-roots heuristic to pick a target. `caretPositionFromPoint`
for click-to-start. Selection API for explicit user selections.
Shadow DOM for the reader UI so host CSS doesn't bleed.

```ts
// content.ts: grab the user's current selection text, or fall back to roots
function captureText(): string {
  const sel = document.getSelection();
  const picked = sel && sel.toString().trim();
  if (picked) return picked;
  const [root] = readable(document.body);
  return root?.innerText.trim() ?? "";
}
chrome.runtime.onMessage.addListener((m, _s, send) => {
  if (m.type === "grab") send({ text: captureText() });
});
```

### Q19. "Microtasks vs `setTimeout(0)` vs `rAF`?"
**Microtask** queue (`Promise.then`, `queueMicrotask`) drains to
completion between every macrotask, before paint, before `setTimeout`
callbacks. `setTimeout(0)` is a **macrotask**, clamped to ≥4 ms after
nesting, runs in the next task. **`rAF`** (`requestAnimationFrame`)
runs once per frame just before the next paint. Use microtasks for
"after this promise but before any UI work"; `rAF` for anything that
mutates layout/paint.

```ts
console.log("sync");
queueMicrotask(() => console.log("micro"));   // 2: drains before any task
setTimeout(() => console.log("timeout"), 0);  // 4: next macrotask
requestAnimationFrame(() => console.log("raf")); // 3: before next paint
Promise.resolve().then(() => console.log("then")); // 2': also micro
// order: sync, micro, then, raf, timeout
```

### Q20. "Event delegation."
**Event delegation** — instead of attaching one handler per child,
you put a single listener on a common ancestor, inspect `event.target`,
and walk up with `closest()` to a known selector. It exploits event
bubbling (events fire on the target, then on each ancestor up to
`document`). Trade-off: fewer listeners, no need to (un)bind as
children mount; cost is one extra walk per event and the gotcha that
`event.target` may be a descendant of the element you actually want.

```ts
document.getElementById("list")!.addEventListener("click", (e) => {
  const item = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
  if (!item) return;
  console.log("clicked", item.dataset.id);
});
```

---

## 9. Leadership / behavioral prompts

The PDF says "recent experiences, no philosophy." Prep five-minute
**STAR** answers for each — STAR stands for **Situation, Task,
Action, Result**: one paragraph framing the context, one for what
you specifically had to do, one for what you did, one for the
outcome (with numbers when possible).

- An incident you owned end-to-end. The detection signal, the
  mitigation, the postmortem action item that actually shipped.
- A cross-team disagreement where you were technically right and
  still chose to compromise. Why.
- A perf win on a real product surface. Specific numbers, specific
  primitives swapped.
- A time you raised the hiring bar — vetoed a candidate other
  interviewers wanted to pass, or pushed for a yes others doubted.
- Mentoring a junior on something hard. Not the topic, the method.
- A scope cut that shipped on time because of the cut.
- A piece of code you regret writing, and what you did about it
  later.
- A time you said no to your manager or skip-level.

---

## 10. CEO chat — questions to ask Cliff Weitzman

Pick 3. Don't ambush him with all five.

- "The accessibility origin is core to the product story. Where on
  the roadmap right now is that origin being most directly served,
  and where is the team furthest from it?"
- "The extension parses arbitrary pages at billion-word scale. What
  has the failure surface taught you about the web that you didn't
  expect when you started?"
- "Tech Lead on Web Core means owning the surface most users touch.
  What's the one engineering call on that surface in the last six
  months you'd revisit if you could?"
- "Speechify ships on iOS, Android, Web, and as an extension.
  Where is the Web team's leverage highest — surface area users see,
  or as the platform other clients integrate against?"
- "You read at 600 words a minute. What's the one product behavior
  power users like you want that average users haven't asked for, and
  how do you decide which of those bets to make?"

---

## 11. Closing notes

- The take-home is the filter. Both the parser and the cache must be
  typeable cold. Practice once a day until the loop.
- The DOM round rewards fluency over cleverness. `console.dir`,
  `$0`, `getEventListeners($0)` — know the console.
- The candidate already has a working reader in this very repo.
  Reference it. Walk the interviewer through it if asked for a recent
  project; it ticks every box the JD lists.
