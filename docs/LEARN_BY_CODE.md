# LEARN by code

Same APIs as `LEARN.md`, but only code. Each step adds one API and uses every previous one.

---

## 0. DOM handles

```ts
const passage_el = document.querySelector('blockquote')!   // the prose container
const text_node  = passage_el.firstChild as Text           // the single text node inside it
```

`passage_el` is the box used by `ResizeObserver` and the click/hover targets. `text_node` is the `Range` anchor for §5 and the equality check in §8.

## 1. The data contract

```ts
type Word     = { start: number }                  // seconds
type Range2   = [number, number]                   // [char_start, char_end]
type Sentence = { start: number; end: number; first_word_index: number; last_word_index: number }

const data: { text: string; ranges: Range2[]; words: Word[]; sentences: Sentence[] }
```

## 2. `<audio>` — the timeline

```ts
const audio = new Audio('/abou.mp3')
audio.preservesPitch = true
audio.playbackRate   = 1
audio.currentTime    // read every frame, write to seek
```

## 3. `requestAnimationFrame` — read `currentTime` → `word_index`

```ts
let word_index = 0
const tick = () => {
  const t = audio.currentTime                                  // ← from §2
  const i = data.words.findLastIndex(w => w.start <= t)        // largest i, start ≤ t
  word_index = i < 0 ? 0 : i
  raf = requestAnimationFrame(tick)
}
let raf = requestAnimationFrame(tick)
```

## 4. word index → sentence index (pure derivation)

```ts
function find_sentence_index_by_word(i: number): number       // returns sentence idx
function find_sentence_index_by_offset(char: number): number  // returns sentence idx

const active_sentence = find_sentence_index_by_word(word_index)   // ← consumes §3
```

## 5. `Range` + `getClientRects` — char range → screen rects

```ts
function rects_for(start: number, end: number): DOMRect[] {
  const r = document.createRange()
  r.setStart(text_node, start)
  r.setEnd(text_node, end)
  return Array.from(r.getClientRects())
}

const [ws, we] = data.ranges[word_index]                      // ← word_index from §3
const word_rects = rects_for(ws, we)

const s = data.sentences[active_sentence]                     // ← from §4
const sent_rects = rects_for(s.start, s.end)
```

## 6. SVG overlay — rects → `<rect>`

```svelte
<svg aria-hidden="true" style="pointer-events:none">
  {#each sent_rects as r}<rect x={r.x - ox} y={r.y - oy} width={r.width} height={r.height} rx="4" />{/each}
  {#each word_rects as r}<rect x={r.x - ox} y={r.y - oy} width={r.width} height={r.height} rx="4" />{/each}
</svg>
```
`ox, oy` come from `passage_el.getBoundingClientRect()`.

## 7. `ResizeObserver` — re-measure trigger

```ts
let resize_tick = 0
const observer = new ResizeObserver(() => resize_tick++)
observer.observe(passage_el)
// §5 rects_for(...) is recomputed in an $effect that reads resize_tick
```

## 8. `caretPositionFromPoint` — pixel → char offset

```ts
function hit(e: PointerEvent): number | null {
  const p = document.caretPositionFromPoint(e.clientX, e.clientY)
  return p?.offsetNode === text_node ? p.offset : null
}
```

## 9. click + hover — compose §8 → §4 → §2

```ts
let hover_sentence = 0                                        // feeds §5/§6 hover layer

passage_el.onclick = e => {
  const c = hit(e); if (c == null) return                     // §8
  const si = find_sentence_index_by_offset(c)                 // §4
  audio.currentTime = data.words[data.sentences[si].first_word_index].start   // §2
}
passage_el.onmousemove = e => {
  const c = hit(e); if (c == null) return
  hover_sentence = find_sentence_index_by_offset(c)
}
```

## 10. keyboard — write to §2

```ts
const on_key = (e: KeyboardEvent) => {
  if (e.target instanceof HTMLInputElement) return
  if (e.code === 'Space')      { audio.paused ? audio.play() : audio.pause(); e.preventDefault() }
  if (e.code === 'ArrowLeft')  { audio.currentTime -= 10;  e.preventDefault() }
  if (e.code === 'ArrowRight') { audio.currentTime += 10;  e.preventDefault() }
}
addEventListener('keydown', on_key)
```

## 11. Media Session — OS transport → §2

```ts
navigator.mediaSession.metadata = new MediaMetadata({ title: 'Abou Ben Adhem', artist: 'Leigh Hunt' })
navigator.mediaSession.setActionHandler('play',         () => audio.play())
navigator.mediaSession.setActionHandler('pause',        () => audio.pause())
navigator.mediaSession.setActionHandler('seekforward',  () => audio.currentTime += 10)
navigator.mediaSession.setActionHandler('seekbackward', () => audio.currentTime -= 10)
```

## 12. `localStorage` — persist §2 state, restore on mount

```ts
const KEY = 'reading-highlight:abou-ben-adhem'

try {                                                          // restore
  const s = JSON.parse(localStorage.getItem(KEY) ?? 'null')
  if (s) { audio.currentTime = s.t; audio.playbackRate = s.rate }
} catch {}

const on_hide = () => {                                       // persist (not every tick!)
  try { localStorage.setItem(KEY, JSON.stringify({ t: audio.currentTime, rate: audio.playbackRate })) } catch {}
}
addEventListener('pagehide', on_hide)
```

## 13. Service worker + bfcache

```ts
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
addEventListener('pageshow', e => { if (e.persisted) log('bfcache.restore') })
```

## 14. Teardown — symmetric to every `addEventListener` above

```ts
cancelAnimationFrame(raf)                       // §3
observer.disconnect()                           // §7
removeEventListener('keydown', on_key)          // §10
for (const a of ['play','pause','seekforward','seekbackward'] as const)
  navigator.mediaSession.setActionHandler(a, null)              // §11
removeEventListener('pagehide', on_hide)        // §12
```

---

### The whole pipeline, one expression

```
audio.currentTime                                  // §2
  → findLastIndex(w => w.start <= t)               // §3   word_index
  → find_sentence_index_by_word(word_index)        // §4   active_sentence
  → data.ranges[word_index] / sentences[i]         // char ranges
  → Range.getClientRects()                         // §5   DOMRect[]
  → <rect> in <svg aria-hidden>                    // §6

click → caretPositionFromPoint → offset            // §8
  → find_sentence_index_by_offset                  // §4
  → audio.currentTime = words[first_word_index].start   // §2 (loop closes)
```
