# 07 — Final route cleanup: drop `data` re-derivation and dead state

Type: AFK
Triage: ready-for-agent

## Parent

`plans/improvements/PRD.md`

## What to build

After issues 01–06 land, `+page.svelte` is most of the way to its target shape but a few residual smells remain. This issue is the final pass that gets the route to ~250 lines.

Drop the `data` re-derivation block:

```ts
let text = $derived(data.text);
let ranges = $derived(data.ranges);
let sentences = $derived(data.sentences);
let timings = $derived(data.timings);
let audio_src = $derived(data.audio_url);
```

`data` is the page-loader output, immutable for the lifetime of the route. The five `$derived` lines exist solely to shorten downstream reads (`text` vs `data.text`). They make the reads look reactive when they aren't, and they take five lines that could be one destructure or zero. Use `data.text`, `data.audio_url`, etc. directly, or destructure once.

Audit and delete any `$state` variable that survived issues 04–06 but no longer has a reader. Expected casualties depending on the exact path the controllers took: `index`, `active_sentence_index`, `hover_sentence_index`, `view`, `playing`, `current_time`, `duration`, `rate`, `audio_el` as state (just keep as `let` since `bind:this` only writes once), and any of the controller handles that don't need to be `$state` because nothing reactive reads them.

Run a final pass to confirm:

- The `<audio>` element is bound once and referenced by exactly one consumer (the playback controller's constructor).
- No `$effect` block contains more than one concern (e.g., no `audio.playbackRate = rate` mixed with `preservesPitch = true` mixed with anything else — those belong in playback init).
- `onMount` is empty or close to it; everything reactive is in `$effect` blocks.
- The route imports nothing from `$lib/playback/find_word_index_at_time`, `$lib/playback/audio_clock`, `$lib/playback/keybindings`, `$lib/playback/hot_path_counter`, `$lib/playback/scroll_controller`, `$lib/highlight/svg_overlay`, `$lib/highlight/renderer`, `$lib/media_session`, `$lib/latency`, `$lib/persistence/session`, or `$lib/persistence/idb_store` directly — those are internals of the three controllers now.

## Acceptance criteria

- [x] `+page.svelte` is ≤ 280 lines including markup and style. (243 lines.)
- [x] `+page.svelte` has ≤ 10 `$state` declarations. (6.)
- [x] `+page.svelte` has ≤ 5 `$effect` blocks. (4.)
- [x] No `$derived` line in the route exists solely to shorten access to `data.*`.
- [x] The route's import list contains only: Svelte runtime, browser flag, `data`/`PageData` type, the three new controllers (`create_playback`, `create_view`, `create_session`), the IDB store factory, `install_debug_hooks`, `set_logger` + the otel logger, and SVG-overlay CSS variable references if any.
- [x] `npx vitest run` is green.
- [ ] `npx playwright test` is green for all surviving specs.
- [ ] Manual smoke at `/`: play, pause, skip, scrub, click-to-seek, rate cycle, snap-back, lock-screen media controls, bfcache resume, degraded-storage toast all behave identically to before the refactor sequence started.

## Blocked by

- `04-extract-create-playback-controller`
- `05-extract-create-view-controller`
- `06-extract-create-session-controller`
