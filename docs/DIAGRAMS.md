# System diagrams

Three views of the reader system: the **architecture** (what lives where),
the **runtime sequence** (what happens when the user clicks), and the
**data flow** (how a character offset becomes a painted rect).

Pre-rendered PNGs sit next to this file under `docs/diagrams/` —
double-click any of them in Finder. The Mermaid source below is the
ground truth; regenerate by running:

```bash
pnpm dlx @mermaid-js/mermaid-cli mmdc \
  -i docs/DIAGRAMS.md -o docs/diagrams/diagram.png
```

---

## 1. Architecture: shared core, two adapters

What lives where. The seam between framework-agnostic TS (used by both
the web app and the extension) and the two app shells. `WordIndexSource`
is the only abstraction that earns its keep — two implementations, one
shared downstream pipeline, no SDK boilerplate.

```mermaid
graph TB
  subgraph core["src/lib/reader/ — framework-agnostic"]
    readability[readability.ts]
    tokenizer[tokenizer.ts]
    highlight["highlight.ts<br/>Range.getClientRects → SVG"]
    wis{{WordIndexSource interface}}
    audio["audio_playback.ts<br/>rAF + audio + findLastIndex"]
    speech["speech_playback.ts<br/>SpeechSynthesis boundary"]
    audio -.implements.-> wis
    speech -.implements.-> wis
  end

  webapp["Web App (Svelte)<br/>$state adapter + page.svelte"]
  ext["Chrome Extension<br/>content.ts + background.ts"]

  webapp --> audio
  webapp --> highlight
  webapp --> tokenizer
  ext --> speech
  ext --> highlight
  ext --> readability
```

---

## 2. Runtime: extension click-to-read sequence

What happens when the user clicks the toolbar icon. Three actors in MV3
(background service worker, content script, page DOM) plus the browser's
TTS engine. The loop at the bottom is the live word-sync.

```mermaid
sequenceDiagram
  participant User
  participant SW as Background SW
  participant CS as Content Script
  participant DOM as Page DOM
  participant TTS as SpeechSynthesis

  User->>SW: click toolbar icon
  SW->>CS: chrome.scripting.executeScript
  CS->>DOM: score block elements
  DOM-->>CS: winning <article>
  CS->>DOM: inject Shadow-DOM player UI
  CS->>TTS: speak(utterance)
  TTS-->>User: audio plays
  loop per word
    TTS-->>CS: onboundary(charIndex)
    CS->>DOM: paint <rect> for current word
  end
```

---

## 3. Data flow: charIndex → painted rect

The four data pieces in flight. Read top-to-bottom: readability picks an
article, the tokenizer (one-shot) gives word ranges, SpeechSynthesis
(live) emits charIndex per word, lookup turns it into a word_index, the
Range API turns that into geometry, the SVG paints it.

```mermaid
flowchart TD
  R[Readability scoring] --> A["article<br/>textContent + text node"]
  A --> S[Intl.Segmenter one-shot]
  A --> T[SpeechSynthesis.speak]
  S --> WR[word_ranges + sentence_spans]
  T -- live --> B["boundary event<br/>charIndex"]
  WR --> W[word_index = lookup charIndex]
  B --> W
  W --> RG["Range setStart/setEnd<br/>getClientRects"]
  RG --> D[DOMRect array]
  D --> O["SVG overlay rect per line"]
```

---

## How to use these in interview prep

- **Diagram 1** answers *"walk me through your codebase."* The defense:
  two consumers, one shared downstream pipeline, `WordIndexSource` is
  the only interface and it earns its keep.
- **Diagram 2** answers *"what happens when the user clicks the
  extension?"* The MV3 three-actor mental model. SW dies after 30 s
  idle; content script dies with the tab; only the page DOM persists.
- **Diagram 3** answers *"how does the highlight know where to paint?"*
  Character offset → word index → range → rects → SVG. Most candidates
  hand-wave this; doing it crisply is the senior signal.
