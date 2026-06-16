# What's missing from LEARN.md

`LEARN.md` is a deep treatment of the **reader surface inside the web
app**: audio sync, highlight rendering, click-to-seek, persistence. It is
not a complete prep doc for the role posted, which is **Tech Lead, Web
Core Product *& Chrome Extension***. The JD names a specific hard problem
— "accurately determine a 'readable' section within every website" — that
the existing doc does not touch.

This file is the gap list, prioritised for interview value. Every entry
leads with a **Problem** — the concrete pain a user or engineer hits —
because solutions are only memorable when you understand what they are
solutions to. If you ever find yourself listing an API name without being
able to describe the pain it removes, you've memorised trivia, not
engineering.

---

## A. The Chrome Extension (the missing half of the role)

### A.1 Readability extraction

**Problem.** The user installs Speechify and clicks "play" on a page.
What does "this page" even mean? A news article has a clear body, but it
also has a nav bar, a related-articles sidebar, a comments section, a
cookie banner, three ads, a newsletter signup, and a footer. If the
extension reads all the text on the page in DOM order, it reads
"Subscribe Subscribe Menu Home About Cookie Settings" before reaching
the headline. That's the product failing in the first three seconds. On
a banking dashboard there is no "article" at all — the largest block of
text is a table of transactions, and reading it aloud is gibberish.
You're standing in front of an arbitrary website, written by people who
did not know you would exist, and you must answer "what should I read?"
in under 200 ms.

**What to cover.**

- **Mozilla Readability.js** as the reference algorithm. Scoring model:
  text density (chars per node), link density (penalised — nav is link-
  heavy, prose isn't), tag weights (`<article>`, `<main>`, `<section>`
  positive; `<nav>`, `<aside>`, `<footer>` negative), ID/class
  heuristics (`comments`, `sidebar`, `ad-*` penalised), parent/sibling
  score propagation.
- **Semantic landmarks first.** Before any heuristic, look for `<main>`,
  `role="main"`, `<article>`, `aria-label` hints. Modern sites annotate;
  respect the annotations and skip the guessing.
- **Failure modes.** SPAs that render `<div><div><div>` with no
  semantics. Banking and dashboards where the largest text block isn't
  prose. Article bodies inside Shadow DOM (Readability can't see in).
  Pages with multiple competing articles (Reddit thread: which comment
  is "the content"?).
- **The product fallback.** When automatic detection misfires, the user
  needs a manual selection affordance — drag-select then "read this."
  Same Selection-API plumbing the web app uses.
- **Design conversation.** Heuristic-only vs heuristic + small ML model
  vs server-side extraction. Trade-offs: latency, privacy (sending the
  page to a server has a permissions story), model size in the
  extension bundle, update cadence (can't hotfix a shipped extension).

### A.2 MV3 service worker architecture

**Problem.** You shipped a Manifest V2 extension last year. It had a
persistent background page that held an in-memory cache of "what this
tab is currently reading," a long-lived WebSocket to the sync server,
and a 5-second heartbeat. Chrome forced you to migrate to MV3 and now
that background page is a service worker that Chrome kills after 30
seconds of idle. Your cache is gone. The WebSocket disconnects every
30 seconds. The heartbeat misses. You can't keep state in memory
anymore because *there is no memory* between invocations. Every design
decision the V2 background page rested on is now wrong.

**What to cover.**

- **The SW dies.** Idle ~30 s and Chrome terminates it. No persistent
  globals, no in-memory caches that survive. State lives in
  `chrome.storage` (sync ≤ 100 KB / item, local ≤ 10 MB total) or
  IndexedDB.
- **Wake triggers.** `chrome.runtime.onMessage`, `chrome.alarms`,
  `chrome.tabs.onUpdated`, `chrome.webNavigation.*`. You design around
  restart, not staying alive.
- **No DOM, no `window`.** The SW has `fetch`, `Cache`, IndexedDB, the
  `chrome.*` APIs. It does *not* have `XMLHttpRequest`, `localStorage`,
  `<audio>`, or any DOM. This is why audio needs an offscreen document
  (A.4).
- **`chrome.alarms` over `setTimeout`.** Timers don't survive SW
  termination; alarms do, with a 30-second minimum on the stable
  channel.

### A.3 Content scripts: isolated vs MAIN world

**Problem.** Your content script sets `window.speechifyReady = true`.
You open DevTools on the page, type `window.speechifyReady`, and get
`undefined`. You're sure your script ran — you can see its console
logs. You then try to read the page's React router state from your
content script, `window.__NEXT_DATA__`, and get `undefined` again. You
swap the order: page sets `window.foo = 1`, your content script reads
`window.foo`, still `undefined`. The DOM is shared but the JavaScript
heap is not. Until you internalise this, every "why doesn't this
work?" debugging session burns an afternoon.

**What to cover.**

- **Isolated world default.** Same DOM as the page, separate JS heap.
  Prototype pollution from the page can't reach you; their `window`
  globals are invisible to you.
- **MAIN world when you must.** Reading page globals (a SPA's router
  state), hooking page-level `fetch`/`XMLHttpRequest`, intercepting
  custom events. Declared via `world: "MAIN"` in manifest
  `content_scripts` or via `chrome.scripting.executeScript({ world:
  "MAIN" })`.
- **Bridging.** `window.postMessage` between isolated and MAIN; custom
  `CustomEvent`s on `document` as a poor man's bus.
- **`document_idle` vs `document_start` vs `document_end`.** Inject too
  early and the DOM isn't there; too late and the page has already
  re-rendered past your hook points. Most readers want `document_idle`
  plus a `MutationObserver` to catch async content.

### A.4 Audio playback under MV3 — offscreen documents

**Problem.** You moved the rAF + `<audio>` loop into the service
worker. It doesn't compile — `Audio` is undefined in a SW. You move it
into a content script. It works until the user switches tabs and the
content script is terminated mid-utterance. The audio stops. You move
it into a popup window — the popup closes the instant the user clicks
elsewhere and audio dies again. There is *no place* in MV3 to put a
long-lived `<audio>` element by default. The model assumed that, and
gave you a specific escape hatch.

**What to cover.**

- **Lifecycle.** `chrome.offscreen.createDocument({ reasons:
  ['AUDIO_PLAYBACK'], justification: '...' })`. One offscreen document
  per extension. The SW messages it to play, pause, seek. The
  offscreen document hosts the rAF + binary-search loop from the web
  app.
- **Why not the content script.** Content scripts die with their tab.
  An offscreen document survives across tab switches, which is what
  "keep reading while I navigate" requires.
- **Three-actor architecture.** SW = source of truth for playback
  state. Offscreen = owner of the `<audio>` element and the time-sync
  loop. Content script = owner of the per-tab highlight DOM. Message
  passing between them, all coordinated through the SW.

### A.5 Highlighting on a hostile DOM

**Problem.** Your `box-decoration-break` highlight works perfectly on
your own reader. You inject the same CSS via a content script into
medium.com and the pills are the wrong size — Medium's global `*`
selector zeroes the padding you depend on. You try the New York Times
and your highlight class collides with `.highlight` which they use for
their own search results. You try a banking site and the page's CSP
blocks your inline `<style>` tag from running at all. Your in-app
techniques worked because *you owned the page*. On the extension you
own nothing — every selector you write is fighting someone else's CSS,
every element you inject is at risk of being styled away by a hostile
parent rule.

**What to cover.**

- **Shadow DOM for the overlay UI.** Player controls, settings panels:
  put them inside a Shadow root attached to a top-level container so
  the page's CSS reset can't reach them. `attachShadow({ mode: 'closed'
  })` if you want strict isolation.
- **CSS isolation for the highlight itself.** You can't shadow-DOM the
  highlight (it must render on the page's text). Options:
  - Highlight API via `::highlight(name)` — the page can't style your
    named highlights without knowing the name. Lowest collision risk.
  - `getClientRects` into an absolute-positioned layer with high
    z-index and `all: initial` on the container to nuke inherited
    styles.
  - `box-decoration-break` on injected spans is *risky* on third-party
    pages — adoptable stylesheets (`document.adoptedStyleSheets =
    [sheet]`) constrained by CSS `@layer` give you specificity
    control.
- **CSP.** Sites with strict CSP block inline `<style>` and `<script>`.
  `chrome.scripting.insertCSS` bypasses page CSP — it's
  extension-origin, not page-origin.
- **z-index wars.** Some sites use `z-index: 2147483647` on modals.
  Your overlay UI must plan for it. The highlight *behind* text is
  less affected.

### A.6 SPA navigation and dynamic content

**Problem.** User opens twitter.com, your content script runs, extracts
the first tweet thread, starts reading. User clicks a different tweet
— the URL changes but the page doesn't reload. Your content script
never runs again. The new tweet is now on screen but your reader is
still reading the old one. Or: user scrolls Reddit, infinite scroll
fires, fifty new comments load, your reader never sees them. The web
of 2005 fired one `DOMContentLoaded` per article. The web of today
mutates the DOM constantly and never reloads.

**What to cover.**

- **`MutationObserver`** at the document root, filtered by added
  subtrees that look text-bearing. Re-run readability when observed
  changes exceed a threshold (new `<article>` element, N hundred words
  of new text).
- **`chrome.webNavigation.onHistoryStateUpdated`** for SPA route
  changes — page doesn't reload, URL changes, content swaps. Hook
  this from the SW and re-extract.
- **Debouncing.** A page that mutates 100 times in a second
  (lazy-loaded ads, image carousels) must not trigger 100
  re-extractions. Coalesce on `requestIdleCallback` or a timer.

### A.7 Permissions, cross-origin, iframes

**Problem.** You ship the extension with `host_permissions:
["<all_urls>"]` because it makes development easy. Your install
conversion is 30% lower than your competitor's, and you can't figure
out why. Users see "This extension can read and change data on every
website you visit" in the install prompt and bounce. Meanwhile a user
loads a Substack newsletter that embeds a tweet in an iframe — your
content script can't see inside the iframe, the user clicks "read this
tweet" and nothing happens. Meanwhile someone embeds your reader's
target page inside a cross-origin frame and you have no idea whether
to extract or skip. Permissions are a product decision dressed up as a
security decision.

**What to cover.**

- **`activeTab` vs `host_permissions`.** `activeTab` grants access to
  the current tab only after explicit user action (toolbar click,
  keyboard shortcut). `host_permissions: ["<all_urls>"]` requires
  install-time opt-in and tanks conversion. Default to `activeTab`,
  declare specific hosts for the long tail you want to auto-activate.
- **`optional_host_permissions`.** Ask at the moment of need ("Add
  this site to Speechify?") — better UX, better funnel.
- **Iframes.** Content scripts run **per frame**, not per page.
  `all_frames: true` in manifest. Cross-frame coordination goes
  through the SW because frames in isolated worlds can't message each
  other directly.
- **Cross-origin iframes (embedded PDFs, embedded newsletters).** Same
  origin policy still applies inside the extension. You can read the
  DOM of a cross-origin iframe **only** if you hold a host permission
  for its origin.

### A.8 Update and rollout strategy

**Problem.** You ship version 2.4.0 on a Friday. By Saturday morning,
the readability extractor is misclassifying every Substack newsletter
as "no content." Your support inbox fills up. You fix the bug in 15
minutes. Now what? On the web app you'd push to prod and refresh —
fixed in 30 seconds. On the extension you submit 2.4.1 to the Chrome
Web Store and wait. Review takes 4 hours to 4 days. While you wait,
every Speechify user on Substack has a broken product. You should
have planned for this *before* you shipped 2.4.0, not after.

**What to cover.**

- **Chrome Web Store staged rollout.** Percentage of users per day;
  monitor crash rate, user reports, can pause and roll back.
- **No hotfix path.** Once a bad version ships, you wait for the next
  approved version. Plan for it.
- **Remote feature flags.** A config endpoint the SW fetches on
  startup. Lets you disable a broken readability heuristic for site X
  without shipping a new version.
- **Kill switch.** Same mechanism — a "disable extension entirely"
  flag for catastrophic regressions, so a user who can't uninstall
  fast enough at least gets a no-op extension instead of a broken one.

### A.9 Storage tiers (extension-specific)

**Problem.** You decide to "just use IndexedDB for everything." A user
changes their voice on their laptop and opens the extension on their
phone. The voice is still the old one — IndexedDB is per-device. You
move to `chrome.storage.sync`. Now you write the user's reading
position to it on every word change and the API silently drops writes
because you exceeded 120 writes/minute. You also blow the 8 KB per-
item quota on the timings JSON for a long document. The extension has
four different storage backends with four different quotas, sync
behaviours, and lifetimes, and you need to pick the right one for
each thing.

**What to cover.**

- **`chrome.storage.sync`** — synced across devices via the user's
  Google account. Tight quota (100 KB total, 8 KB per item; rate-
  limited). For: voice choice, playback rate, "last position per
  recent document_id" (small N).
- **`chrome.storage.local`** — local only, 10 MB. For: per-site
  readability config overrides, cached extraction results.
- **IndexedDB** — for the rest. Audio blobs (offline story from
  LEARN §7), large timings JSON.
- **`chrome.storage.session`** — in-memory, cleared on browser
  restart, ~10 MB. For transient SW state that mustn't survive
  termination but should survive SW death within a session.

---

## B. Web app — gaps and depth

### B.1 Media Session API

**Problem.** Your typical Speechify user puts their phone in their
pocket, plugs in headphones, and walks. They never look at the screen
again. They want to pause with the inline headphone button, skip a
sentence with the double-click, see the title on their watch, control
playback from the car's Bluetooth head unit. None of this works
because your `<audio>` element has no metadata attached and no action
handlers registered. The product *is* listening-without-looking, and
the listening-without-looking layer doesn't exist.

**What to cover.**

- `navigator.mediaSession.metadata = new MediaMetadata({ title,
  artist, artwork })` — populates lock screen, watch, car display.
- Action handlers: `'play'`, `'pause'`, `'seekbackward'`,
  `'seekforward'`, `'previoustrack'`, `'nexttrack'`. Map track-skip to
  sentence-skip in a reader; map seek to a few seconds.
- `setPositionState({ duration, playbackRate, position })` so the OS
  scrubber matches reality and updates as you read.

### B.2 PDF extraction

**Problem.** The JD says "upload any PDF." You drop in a PDF and try
to extract text. The PDF was generated from InDesign and the
characters come out in the wrong order — the file stores glyphs
positionally, not in reading order, and you got the order they were
drawn in. You fix that with pdf.js's `getTextContent()` and now the
text is right, but where do words start and end? The PDF has no
spaces between words — just glyphs at `(x, y)` positions. You guess
at word boundaries from spacing, but the columns of a magazine layout
break your guess. Then you try a scanned PDF: it's an image, there is
no text, you have nothing.

**What to cover.**

- **PDFs don't have words.** A PDF is glyphs at `(x, y)`. Word
  boundaries are inferred from inter-glyph spacing relative to font
  size. pdf.js's `getTextContent()` gives items with positions; you
  reconstruct words yourself or accept pdf.js's heuristic.
- **Highlighting over canvas.** pdf.js renders each page to a canvas.
  Your highlight is a `<div>` layer with rects in PDF coordinate space
  mapped to canvas pixel space via `page.getViewport({ scale })`.
- **Multi-column, RTL, ligatures.** All real-world failure modes.
  Ligatures (`fi` as one glyph) break character offset math.
- **OCR fallback.** Scanned PDFs are images. You need a server OCR
  path (Tesseract or cloud), returning `(text, char_ranges,
  page_geometry)` plus per-word confidence.

### B.3 Streaming TTS and MSE

**Problem.** Your TTS service synthesises a 30-minute document. The
naive path: synthesise the whole thing server-side, return a single
MP3, play it. Cost: the user waits 90 seconds for "Play" to do
anything. Real Speechify ships chunks of audio as they're synthesised
— utterance 1 starts playing while utterance 7 is still being
generated. You can't do that with `<audio src=blob>` because the blob
must be the full file. You need a primitive that lets the `<audio>`
element consume an open-ended stream of audio chunks.

**What to cover.**

- **MediaSource Extensions.** `new MediaSource()`, `addSourceBuffer`,
  `sourceBuffer.appendBuffer(chunk)`. The `<audio>` element gets a
  `blob:` URL pointing at the `MediaSource`; chunks flow over the
  network and append as they arrive.
- **Gapless concatenation.** Chunk boundaries must not click. MP3 has
  encoder/decoder padding (LAME delay) that produces audible gaps;
  Opus and AAC handle this cleaner. Choose codec accordingly, or use
  Web Audio `AudioBufferSourceNode` scheduling for sample-accurate
  joins.
- **Seek-ahead.** If the user seeks past the buffered range, fetch
  chunks covering that timestamp and append. Needs server support for
  "give me audio for word range [i, j]" or per-utterance chunked URLs.

### B.4 Tokenization on a Web Worker

**Problem.** User uploads a 400-page novel. You call `Intl.Segmenter`
on the full text on the main thread. The browser locks for 2–4
seconds. INP tanks, the page is white, the user thinks the app crashed.
You moved virtualization into §10 of LEARN — but virtualization assumes
you already *have* tokenised text. The tokenization itself is the
jank source you forgot.

**What to cover.**

- **Worker offload.** `new Worker()` running a module that tokenises
  on receipt of text and posts back `{ word_ranges, sentence_spans }`.
  Main thread stays responsive.
- **Streaming.** If the text is paginated, tokenise per page; prefetch
  the next page in the background.
- **Transferable objects.** Send `ArrayBuffer`s with `transfer: [buf]`
  to avoid the structured-clone copy when shipping large payloads.

### B.5 Audio latency, measured not guessed

**Problem.** LEARN §2 says "subtract 60–100 ms" for audio output
latency. Fine — until a user plugs in AirPods and the lag jumps to
220 ms. Or plugs in a USB DAC that has 8 ms latency. Or opens the app
in a low-power mode where the audio buffer doubles. Your constant is
wrong every time the audio path changes, and it's wrong by a lot.
The right answer isn't "guess better." The right answer is "ask the
browser, which knows."

**What to cover.**

- `AudioContext.outputLatency` and `baseLatency` quantify the audio
  graph's contribution to end-to-end latency. Combine with codec
  decode latency and the rAF tick.
- Bluetooth adds 100–300 ms on its own and varies by codec (SBC vs
  aptX vs AAC). You can't detect Bluetooth from JS, but you *can*
  detect when `outputLatency` jumps — handle the change live.
- **Calibration UX.** A "tap when you hear the beep" affordance in
  settings beats a hardcoded constant for the cases the browser can't
  see (Bluetooth, system DSP). Persist the per-device offset.

### B.6 bfcache compatibility

**Problem.** User reads an article in your web app, taps a link to a
referenced piece, hits the browser back button. Expectation: instant
return to exactly where they were, audio still queued, highlight
still on the same word. Reality: full page reload, audio restarts
from the beginning, the user is furious. You added a `beforeunload`
listener five sprints ago to warn about unsaved settings. That single
listener disables bfcache in Safari and Chrome, and the entire
back-button experience is now a reload. The cheapest accessibility
feature in the browser, and one line of code turned it off.

**What to cover.**

- `unload` and `beforeunload` listeners disable bfcache. Don't add
  them; if you must, set them up and tear them down conditionally
  only when actually-unsaved-state exists.
- Persist on `pagehide` instead — bfcache-compatible.
- `pageshow` event with `event.persisted === true` tells you the page
  came back from bfcache and you may need to resync (timer state,
  WebSocket reconnect).

### B.7 User-vs-programmatic scroll

**Problem.** User is following along with the highlight. They scroll
up two paragraphs to re-read a sentence they missed. Your auto-scroll
effect fires on the next word boundary and yanks them back down. They
scroll up again. You yank them down again. The user gives up and
disables auto-scroll entirely — losing the feature for the next 400
pages because of two seconds of conflict. The reader has to *yield*
to the user when the user is actively reading something else.

**What to cover.**

- Listen for `wheel`, `touchstart`, `keydown` (arrows, PgUp/PgDn,
  space). Set a `user_is_scrolling` flag. Clear after N seconds of
  idle.
- Don't try to distinguish your own programmatic `scrollBy` from the
  user's scroll (the events overlap). Instead, *gate* programmatic
  scroll on the idle flag — if the user just scrolled, you don't.
- Optional: a "snap back to highlight" button so the user can opt back
  in instead of waiting for the timer.

### B.8 Cross-device position sync

**Problem.** User reads 90 minutes on the train via the phone app,
gets home, opens the web app. The web app shows them at minute zero.
They have to scrub. Or worse: they listen on the phone, the train
goes through a tunnel, the phone goes offline, they keep listening
from buffered audio, and when they reconnect three later positions
race-condition over each other. "Resume across devices" is in the JD;
LEARN §7 only covers local persistence.

**What to cover.**

- Shape: `(user_id, document_id) → { position, voice, rate,
  updated_at, device_id }`. Last-write-wins on `updated_at` is fine
  for a single user across their own devices.
- Transport: WebSocket for live cross-device, plain REST for
  resume-on-open.
- Conflict: two devices listening at the same time. Define the policy
  — "most recently active device wins, the other pauses" is
  reasonable.
- Offline: queue writes in IndexedDB, drain on `online` event.

### B.9 Telemetry — measuring sync quality in prod

**Problem.** You ship the reader. Sentry shows no errors. Are users
happy? You have no idea. The product's quality bar is "the highlight
lands on the right word at the right time," and you have *zero*
visibility into whether that's true for the long tail of devices,
networks, Bluetooth headsets, playback rates. The interview won't ask
you to write code for this, but they'll ask how you'd *know* the
product works, and "we have Sentry" is not the right answer for a
tech lead.

**What to cover.**

- **Word-sync drift.** Sample `|expected_word_index −
  actual_word_index|` every 5 s during playback. Emit p50/p95/p99 per
  voice, per playbackRate, per device class.
- **Highlight-paint latency.** From `audio.currentTime` advance to
  highlight DOM write, via `performance.mark`/`measure`.
- **Click-to-seek round-trip.** Click event → audible position
  change. Target < 200 ms.
- **Error rates.** `audio.error` by `MEDIA_ERR_*`, SW fetch failures,
  readability confidence on the extension side.
- **Core Web Vitals** (LCP, INP, CLS) as a baseline.

### B.10 Web Speech API as a degraded fallback

**Problem.** Your TTS service has a 30-minute outage. Every Speechify
user worldwide gets a spinner. The user opens a book to read on the
train, the spinner spins, the train enters a tunnel, the user gives
up and uninstalls. Meanwhile the browser has a built-in TTS engine
sitting right there, capable of reading any text aloud with zero
network. It would be a worse experience — no branded voice, no
advance highlight — but "worse experience" beats "no product." LEARN
§11 correctly explains why Web Speech isn't the primary path, but
treats it as not-an-option rather than degraded-mode.

**What to cover.**

- `SpeechSynthesis` as offline / outage fallback. Voices are OS-
  provided; the highlight cannot lead the voice but can still follow
  the `boundary` events (word-granularity, fired live).
- UX: surface the degraded state honestly ("Using your device's
  voice while we reconnect"); don't fake the branded-voice
  experience.
- Auto-recovery: probe the primary service, swap back when it's
  healthy.

---

## C. Things to push back on or refine

### C.1 Hinted search beats pure binary on the hot path

**Problem.** LEARN §2 frames the choice as binary-search vs forward-
pointer and lands on binary. Fine for correctness. But the *hot
path* — the rAF tick at 60 Hz during normal play — almost always
finds the word index advanced by 0 or 1 from the last frame. Binary
over 10k words costs ~14 comparisons every frame. A hint-based search
costs 0–2 comparisons in the common case and falls back to binary on
seek. The senior answer isn't "binary"; it's "binary is the *fallback*,
the hot path is a hint."

**What to cover.**

- Start at `last_index`; walk forward 0–3 steps for the common case.
- Detect scrub via `|new_time − last_time| > threshold` (e.g. 1 s);
  fall back to binary.
- This is a tiny optimisation in absolute terms but a senior signal in
  interview terms — it shows you think about the hot path, not the
  worst case.

### C.2 Highlight API browser support

**Problem.** LEARN §4.3 presents the Highlight API as a clean
alternative to the other two techniques but doesn't name the support
gap. As of late 2025: Chrome 105+, Safari 17.2+, Firefox still
behind a flag. If you reach for the Highlight API as your only path,
every Firefox user gets nothing. An interviewer who knows the matrix
will push on this.

**What to cover.**

- Current support status, said out loud.
- Fallback strategy: detect `'highlights' in CSS`, fall back to §4.1
  (`box-decoration-break`) or §4.2 (`getClientRects`).
- The composition story ("three named highlights stack") has to
  degrade gracefully — what does Firefox see?

### C.3 `localStorage` failure modes beyond blocking

**Problem.** LEARN §7 names "blocks main thread" as the reason to
avoid `localStorage`. Two more failure modes will bite a real reader:
a quota-exceeded write throws *synchronously* with no graceful API,
and concurrent writes from multiple tabs produce silent last-write-
wins with no notification. The "blocks main thread" framing misses
the actual production incidents.

**What to cover.**

- **Quota exceeded throws synchronously.** Wrap every write in
  try/catch and have a fallback (degrade to in-memory, surface a
  toast).
- **Cross-tab races.** Two tabs writing the same key: last write
  wins, no notification to the writer. The `storage` event fires on
  *other* tabs, not the writer. IndexedDB-with-promise is the answer
  for anything non-trivial.

### C.4 Structural — retrieval over learning

**Problem.** LEARN is organised for *learning* — you read it top to
bottom and the ideas build. Under interview pressure you don't read,
you *retrieve*. The current structure makes "give me the elevator
architecture" or "give me the highlight trade-offs side by side"
slow to reach. The §12 cheat sheets are gold but you have to scroll
to them, and they're prose, not lookup tables.

**What to cover.**

- A **60-second elevator architecture paragraph** at the very top —
  server returns `{audio, text, timings}`, rAF reads `currentTime`,
  binary search → word index, three-technique highlight, click-to-seek
  via caret hit-test, SW + Cache + IDB for offline. Memorised, said
  cold.
- A **trade-off matrix** of the three highlight techniques across
  (DOM mutation, AT-friendly, scales to 100k words, supports pill
  shape, browser support, animatable). §4.6 is a "want → use" table;
  the *axes* table is what an interviewer pushes on.

---

## D. Prep checklist

- [ ] Implement readability extraction (Readability.js or equivalent)
      across 10 sample sites: news, blog, banking, dashboard, forum,
      Medium, SPA, PDF-viewer, GitHub, Substack. Note every failure.
- [ ] Build a minimal MV3 extension: content script + offscreen
      document for audio + `chrome.storage` for position.
- [ ] Render the same highlight (Highlight API) on three sites with
      hostile CSS, confirm no collisions.
- [ ] Wire Media Session API into the existing web-app examples.
- [ ] Add `AudioContext.outputLatency`-based calibration; confirm the
      highlight tightens on Bluetooth.
- [ ] Move `Intl.Segmenter` to a Web Worker; measure main-thread time
      before and after on a 50k-word document.
- [ ] Draft and rehearse the 60-second elevator architecture out loud.
- [ ] Draft the highlight-technique trade-off matrix.

