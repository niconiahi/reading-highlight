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
  private map = new Map<K, Entry<V>>();

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
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, expires_at: this.now() + this.ttl_ms });
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
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

**Three explicit layers** make the parser readable: a **LEXER** (low-level
char-stream ops), a **GRAMMAR** (recursive-descent productions that build
the AST), and **TREE-WALKS** (pure functions over the AST). Every branch
is a `switch` so the dispatch points jump out:

```ts
export type SsmlNode =
  | { type: "text"; value: string }
  | { type: "element"; name: string; attributes: Record<string, string>; children: SsmlNode[] };

// ─── ERRORS ───────────────────────────────────────────────────────────────
// Centralized error factories. Every throw site in the parser goes through
// one of these — single source of truth for message format, easy to grep,
// easy to swap for a custom Error subclass later.
const ErrorExpectedChar          = (ch: string, i: number)       => new Error(`expected '${ch}' at ${i}`);
const ErrorExpectedQuote         = (i: number)                   => new Error(`expected '"' or "'" at ${i}`);
const ErrorExpectedAttributeName      = (i: number)                   => new Error(`expected attribute name at ${i}`);
const ErrorExpectedTagTerminator = (name: string, i: number)     => new Error(`expected '>' or '/>' after <${name}> at ${i}`);
const ErrorMismatchedClose       = (open: string, close: string) => new Error(`mismatched </${close}> for <${open}>`);
const ErrorTrailingInput         = (i: number)                   => new Error(`trailing input at ${i}`);
const ErrorUnterminatedSequence  = (s: string, i: number)        => new Error(`unterminated '${s}' starting at ${i}`);
const ErrorUnknownEntity         = (name: string, i: number)     => new Error(`unknown entity '&${name};' at ${i}`);
const ErrorUnterminatedEntity    = (i: number)                   => new Error(`unterminated entity reference at ${i}`);

// ─── LEXER ────────────────────────────────────────────────────────────────
// Owns the cursor. Everything else asks the lexer to peek / consume / read.

function lexer(src: string) {
  let i = 0;
  return {
    get i() { return i; },
    eof: () => i >= src.length,
    peek: () => src[i] ?? "",
    starts_with: (s: string) => src.startsWith(s, i),
    consume: () => {
      const c = src[i];
      i++;
      return c;
    },
    expect: (ch: string) => {
      if (src[i] !== ch) throw ErrorExpectedChar(ch, i);
      i++;
    },
    advance_past: (s: string) => {
      const end = src.indexOf(s, i);
      if (end < 0) throw ErrorUnterminatedSequence(s, i);
      i = end + s.length;
    },
    skip_ws: () => { while (i < src.length && /\s/.test(src[i])) i++; },
    read_name: () => {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_\-:]/.test(src[i])) i++;
      return src.slice(start, i);
    },
    read_quoted_string: () => {
      const quote = src[i];
      i++;
      if (quote !== '"' && quote !== "'") throw ErrorExpectedQuote(i - 1);
      const start = i;
      while (i < src.length && src[i] !== quote) i++;
      const value = decode_entities(src.slice(start, i));
      i++; // closing quote
      return value;
    },
    read_text_run: () => {
      const start = i;
      while (i < src.length && src[i] !== "<") i++;
      return decode_entities(src.slice(start, i));
    },
  };
}
type Lexer = ReturnType<typeof lexer>;

// SSML element names. The parser accepts any well-formed XML name, but the
// tree-walks switch on a known subset. Naming them here removes magic strings
// and documents what subset of SSML 1.1 this code understands.
const SSML_ELEMENT = {
  ROOT:      "#root",   // synthetic top node, not a real SSML tag
  SPEAK:     "speak",
  PARAGRAPH: "p",
  SENTENCE:  "s",
  BREAK:     "break",
  PROSODY:   "prosody",
  SAY_AS:    "say-as",
  MARK:      "mark",
} as const;

// Entity tables — see XML 1.0 §4.6 "Predefined Entities".
// Map (over plain object) gives explicit-not-found semantics via `.get()`,
// avoiding accidental prototype-chain collisions. Shared by the lexer (decode
// at parse time) and the tree-walks (encode at serialize time).
const ENTITY_DECODE = new Map<string, string>([
  ["lt",   "<"],
  ["gt",   ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["amp",  "&"],
]);
const ENTITY_ENCODE = new Map<string, string>([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
]);

// Single-pass scan. O(n) instead of O(n·k) chained-replace. As a bonus, the
// algorithm CAN'T double-process: each char is touched exactly once, so the
// "&amp; LAST" ordering trap is structurally impossible.
function decode_entities(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "&") {
      const end = s.indexOf(";", i + 1);
      if (end < 0) throw ErrorUnterminatedEntity(i);
      const name = s.slice(i + 1, end);
      const replacement = ENTITY_DECODE.get(name);
      if (replacement === undefined) throw ErrorUnknownEntity(name, i);
      out += replacement;
      i = end + 1;
      continue;
    }
    out += s[i];
    i++;
  }
  return out;
}

// Symmetric single-pass: lookup per char, fall through if not in the map.
// No "& FIRST" trap — each input char is consumed once and replaced atomically.
function encode_entities(s: string): string {
  let out = "";
  for (const c of s) out += ENTITY_ENCODE.get(c) ?? c;
  return out;
}

// ─── GRAMMAR ──────────────────────────────────────────────────────────────
// Recursive-descent productions. One function per rule. Branches via switch.

export function parse_ssml(input: string): SsmlNode {
  const l = lexer(input);
  const root: SsmlNode = {
    type: "element",
    name: SSML_ELEMENT.ROOT,
    attributes: {},
    children: parse_children(l),
  };
  if (!l.eof()) throw ErrorTrailingInput(l.i);
  return root;
}

// Returns the collected children. Stops at EOF or at the parent's </close>
// (which the caller will consume). Pure: no mutation of a passed-in parent.
function parse_children(l: Lexer): SsmlNode[] {
  const children: SsmlNode[] = [];
  while (!l.eof()) {
    switch (true) {
      case l.starts_with("<!--"):
        l.advance_past("-->");
        continue;
      case l.starts_with("</"):
        return children; // close tag — caller consumes it
      case l.peek() === "<":
        children.push(parse_element(l));
        continue;
      default: {
        const text = l.read_text_run();
        if (text) children.push({ type: "text", value: text });
      }
    }
  }
  return children;
}

function parse_element(l: Lexer): SsmlNode {
  l.expect("<");
  const name = l.read_name();
  const attributes = parse_attributes(l);
  l.skip_ws();

  // Switch on the terminator: "/" = self-close, ">" = open with children.
  switch (l.peek()) {
    case "/":
      l.consume();
      l.expect(">");
      return { type: "element", name, attributes, children: [] };
    case ">": {
      l.consume();
      const children = parse_children(l);
      // Now expect "</name>".
      l.expect("<"); l.expect("/");
      const close = l.read_name();
      if (close !== name) throw ErrorMismatchedClose(name, close);
      l.skip_ws();
      l.expect(">");
      return { type: "element", name, attributes, children };
    }
    default:
      throw ErrorExpectedTagTerminator(name, l.i);
  }
}

function parse_attributes(l: Lexer): Record<string, string> {
  const attributes: Record<string, string> = {};
  while (true) {
    l.skip_ws();
    // Switch on first non-ws char: terminator → done, else read another attribute.
    switch (l.peek()) {
      case "/":
      case ">":
        return attributes;
      default: {
        const name = l.read_name();
        if (!name) throw ErrorExpectedAttributeName(l.i);
        l.expect("=");
        attributes[name] = l.read_quoted_string();
      }
    }
  }
}

// ─── TREE-WALKS ───────────────────────────────────────────────────────────
// Pure functions over the AST. Switch on node.type first, then on name.

export function serialize_ssml(node: SsmlNode): string {
  switch (node.type) {
    case "text":
      return encode_entities(node.value);
    case "element": {
      const inner = node.children.map(serialize_ssml).join("");
      if (node.name === SSML_ELEMENT.ROOT) return inner;
      const attributes = Object.entries(node.attributes)
        .map(([k, v]) => ` ${k}="${encode_entities(v)}"`).join("");
      if (node.children.length === 0) return `<${node.name}${attributes}/>`;
      return `<${node.name}${attributes}>${inner}</${node.name}>`;
    }
  }
}

export function ssml_to_text(node: SsmlNode): string {
  switch (node.type) {
    case "text":
      return node.value;
    case "element":
      switch (node.name) {
        case SSML_ELEMENT.BREAK: return " ";
        default:                 return node.children.map(ssml_to_text).join("");
      }
  }
}

// "extract text solely from <s> sentence elements":
export function extract_sentences(node: SsmlNode): string[] {
  const out: string[] = [];
  const walk = (n: SsmlNode): void => {
    switch (n.type) {
      case "text": return;
      case "element":
        switch (n.name) {
          case SSML_ELEMENT.SENTENCE:
            out.push(ssml_to_text(n).trim());
            return; // do NOT descend — already captured
          default:
            n.children.forEach(walk);
        }
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

Implementation in Q3 (`firstLineHeight`). Same shape, with the `TreeWalker` fix for nested inlines.

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

#### 4.2.1 Readability-faithful variant — what to reach for if probed

The §4.2 implementation is the whiteboardable simplification. If the
interviewer probes "how does Mozilla Readability actually do this?",
upgrade to the real `_grabArticle` shape: **don't score block
containers directly — score `<p>`-like nodes and propagate the score
up the ancestor chain**, then weight every candidate by
`(1 - linkDensity)` at the end. This is structurally what `Readability.js`
does in `_grabArticle` / `initialize_node` / `get_class_weight` /
`get_link_density`. Mirroring those names in the answer is a low-cost
signal that you've read the library.

```ts
const REGEXPS = {
  positive: /article|content|main|body|entry|post|story/i,
  negative: /comment|sidebar|footer|header|nav|menu|ad-|promo|share|social/i,
};
const DEFAULT_N_TOP_CANDIDATES = 5;
const DEFAULT_CHAR_THRESHOLD = 140;
const MIN_TEXT_TO_SCORE = 25;
const READERABLE_MIN_SCORE = 20;

// O(1) tag-base lookup. Map (over Record) keeps the "small fixed table"
// intent explicit and lets us iterate keys later if we ever need to.
const TAG_BASE = new Map<string, number>([
  ["ARTICLE", 30], ["MAIN", 20],
  ["SECTION", 5], ["DIV", 5],
  ["BLOCKQUOTE", 3], ["PRE", 3], ["TD", 3],
  ["ADDRESS", -3], ["OL", -3], ["UL", -3], ["DL", -3],
  ["DD", -3], ["DT", -3], ["LI", -3], ["FORM", -3],
  ["H1", -5], ["H2", -5], ["H3", -5],
  ["H4", -5], ["H5", -5], ["H6", -5], ["TH", -5],
]);

// Per-element memo: `textContent` walks the whole subtree, and several
// passes ask for the same element's text. WeakMap means entries die with
// the elements — no cleanup, no leak.
const text_cache = new WeakMap<Element, string>();
function get_inner_text(el: Element): string {
  const cached = text_cache.get(el);
  if (cached !== undefined) return cached;
  const text = (el.textContent ?? "").trim().replace(/\s+/g, " ");
  text_cache.set(el, text);
  return text;
}
function get_link_density(el: Element): number {
  const text_len = get_inner_text(el).length;
  if (!text_len) return 0;
  let link_len = 0;
  for (const a of el.querySelectorAll("a")) link_len += get_inner_text(a).length;
  return link_len / text_len;
}
function get_class_weight(el: Element): number {
  let w = 0;
  const sig = `${el.className} ${el.id}`;
  if (REGEXPS.negative.test(sig)) w -= 25;
  if (REGEXPS.positive.test(sig)) w += 25;
  return w;
}
function count_commas(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 44) n++;
  return n;
}

export function find_readable_roots(root: HTMLElement = document.body): HTMLElement[] {
  // Map presence IS candidate membership — one structure, one invariant.
  // Insertion order is preserved, so step 3 iterates deterministically.
  const scores = new Map<HTMLElement, number>();

  // 1. collect paragraph-like nodes worth scoring — let the browser do the
  //    tag filter natively instead of TreeWalker + Set.has in JS.
  const paragraphs = root.querySelectorAll<HTMLElement>("p, pre, td");

  // 2. score each, propagate up to ancestors with a level divider
  const stop = root.parentElement;
  for (const paragraph of paragraphs) {
    const text = get_inner_text(paragraph);
    if (text.length < MIN_TEXT_TO_SCORE) continue;
    const content_score = 1 + count_commas(text) + Math.min(Math.floor(text.length / 100), 3);
    let level = 0;
    for (let ancestor = paragraph.parentElement; ancestor && ancestor !== stop; ancestor = ancestor.parentElement) {
      const divider = level === 0 ? 1 : level === 1 ? 2 : level * 3;
      const score = scores.get(ancestor);
      if (score === undefined) {
        const base = (TAG_BASE.get(ancestor.tagName) ?? 0) + get_class_weight(ancestor);
        scores.set(ancestor, base + content_score / divider);
      } else {
        scores.set(ancestor, score + content_score / divider);
      }
      level++;
    }
  }

  // 3. final weighting + filters, sort. Repeated `get_inner_text` calls
  //    are cheap because `text_cache` memoizes them per element.
  const ranked: { el: HTMLElement; score: number }[] = [];
  for (const [el, raw] of scores) {
    if (get_inner_text(el).length < DEFAULT_CHAR_THRESHOLD) continue;
    const ld = get_link_density(el);
    if (ld > 0.5) continue;
    const score = raw * (1 - ld);
    if (score > 0) ranked.push({ el, score });
  }
  ranked.sort((a, b) => b.score - a.score);

  // 4. collapse ancestor/descendant duplicates, cap at N.
  //    `Node.contains` returns true for self, so identity check is redundant.
  const picked: HTMLElement[] = [];
  for (const { el } of ranked) {
    if (picked.some((kept) => kept.contains(el) || el.contains(kept))) continue;
    picked.push(el);
    if (picked.length >= DEFAULT_N_TOP_CANDIDATES) break;
  }
  return picked;
}

// Mirror of Readability's isProbablyReaderable — Firefox uses this to decide
// whether to even show the Reader View button. Useful in the extension to
// skip mounting the TTS button on dashboards / banking apps.
export function is_probably_readerable(root: HTMLElement = document.body): boolean {
  let score = 0;
  for (const paragraph of root.querySelectorAll<HTMLElement>("p, pre, article")) {
    const text = get_inner_text(paragraph);
    if (text.length < DEFAULT_CHAR_THRESHOLD) continue;
    score += Math.sqrt(text.length - DEFAULT_CHAR_THRESHOLD);
    if (score > READERABLE_MIN_SCORE) return true;
  }
  return false;
}
```

What's different from §4.2 and why each change is defensible:

- **Score paragraphs, not containers.** The simple version scored every
  block element by its own text. Readability scores `<p>`/`<pre>`/`<td>`
  and walks each one's ancestor chain, adding `content_score / divider`
  to each ancestor. Parent gets full, grandparent gets half, then
  `level * 3`. Effect: nav and footer never become candidates because
  they don't contain scorable paragraphs, so nothing ever lifts them
  onto the candidate list at all. Cleaner than scoring everything and
  rejecting after.
- **`content_score = 1 + commas + min(len/100, 3)`.** Length is capped
  per-paragraph so one giant `<p>` can't dominate; the signal you want
  is "many medium paragraphs", which is exactly prose.
- **`score *= (1 - linkDensity)` at the end.** Multiplicative, not a
  cliff. A 0.4-link-density block keeps 60% of its score; a 0.9 block
  keeps 10%. The simple version's `linkDensity > 0.5 → reject` is also
  applied as a final guard.
- **`initialize_node` weights.** Tag-base + class-weight in one place,
  matching `Readability.js`. Lists, list items, forms, and headings get
  negative bases — they're prose-shaped only superficially.
- **Single `Map<HTMLElement, number>` for scores.** Readability.js
  stashes `el._readability` on the node itself — that works but pollutes
  the DOM and needs a final cleanup pass. We use one `Map` where
  presence IS candidate membership: no parallel `Set`, no "is this
  initialized?" check duplicated across two structures. Map preserves
  insertion order, so step 3 iterates deterministically; lifetime is
  the function's, so a plain `Map` is honest about that (a `WeakMap`
  would buy nothing here since the structure never escapes the call).
- **`is_probably_readerable` companion.** Same name as Mozilla's helper,
  same shape. Cheap pre-check the extension calls before doing any of
  the heavy work above.

What to say out loud while writing this:

> "I'm modeling this after Mozilla Readability's `_grabArticle`. The
> simplification — scoring containers directly — would also pass these
> tests, but it has a failure mode on real pages where a sidebar
> wrapper's combined text crosses the threshold. Scoring paragraphs and
> propagating up is what makes that not happen. The link-density
> multiplier at the end is the second guard. I'm exporting
> `is_probably_readerable` separately because the extension wants a fast
> 'is this even worth running TTS on' check before the expensive
> per-page work."

Caveats to flag, unprompted:

- "I'm not crossing shadow roots or iframes in this pass — Readability
  doesn't either, and cross-origin iframes would throw anyway."
- "Real Readability mutates the document. I'm not — I'm returning roots
  to read from, not rewriting the DOM into a Reader View."
- "The constants (30/20/5, divider thresholds, 140-char floor) are
  tuned, not derived. I'd treat them as configurable in production."

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

See §8 Q15 for the implementation.

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

Full implementation in §4.2 (`find_readable_roots`) — TreeWalker + NEGATIVE/POSITIVE class regex + ancestor/descendant collapse.

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
    const attrs = { x: rect.x - host.x, y: rect.y - host.y, width: rect.width, height: rect.height, rx: 2, fill: "yellow" };
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
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
  let lo = 0, hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (words[mid].start <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}
```

### Q15. "Design a job queue."
§5 above. Counter + waiter queue. `acquire`/`release` around the
user-provided async fn.

```ts
function queue(limit: number) {
  let active = 0;
  const waiters: PromiseWithResolvers<void>[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= limit) {
      const w = Promise.withResolvers<void>();
      waiters.push(w);
      await w.promise;
    }
    active++;
    try { return await fn(); }
    finally { active--; waiters.shift()?.resolve(); }
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
queueMicrotask(() => console.log("micro"));
setTimeout(() => console.log("timeout"), 0);
requestAnimationFrame(() => console.log("raf"));
Promise.resolve().then(() => console.log("then"));
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
