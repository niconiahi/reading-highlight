# 05 — Extract `create_view` controller; passage DOM helpers move out of the route

Type: AFK
Triage: ready-for-agent

## Parent

`plans/improvements/PRD.md`

## What to build

`+page.svelte` currently owns ~60 lines of pure DOM/Range helpers — `get_passage_text_node`, `make_range`, `get_caret_offset`, `get_active_word_rect` — that have nothing to do with the route's concerns. They exist to power the click-to-seek mouse handlers and the snap-back scroll logic, both of which are really the renderer/view's job. The SVG renderer and the scroll controller are also attached via separate `$effect` blocks even though both depend on the same passage geometry.

Introduce `create_view(passage_el, scroll_root, playback_view, { ranges, sentences })` in `$lib/view/index.svelte.ts` that absorbs all passage-DOM logic plus the SVG renderer plus the scroll controller. `playback_view` is a minimal coupling surface — the view subscribes directly to playback's reactive getters via a small interface so it can keep highlight and scroll in sync without the route plumbing word-index callbacks through:

```ts
type PlaybackView = {
  readonly word_index: number;
  readonly active_sentence_index: number;
};

create_view(passage_el, scroll_root, playback_view, { ranges, sentences }): {
  // queries driven by mouse events
  sentence_at(event: MouseEvent): number;
  seek_target_word_at(event: MouseEvent): number | null;
  set_hover_sentence(sentence_index: number): void;

  // scroll affordance
  snap_back(): void;

  // reactive reads
  readonly hover_sentence_index: number;
  readonly snap_back_visible: boolean;
  readonly svg: {
    overlay_w: number;
    overlay_h: number;
    path_hover: string;
    path_active: string;
    path_word: string;
  };

  teardown(): void;
}
```

Route mouse handlers become:

```ts
onmousemove={(e) => view?.set_hover_sentence(view.sentence_at(e))}
onclick={(e) => {
  const w = view?.seek_target_word_at(e);
  if (w != null) playback?.seek_to_word(w);
}}
```

The route stops importing `find_sentence_index_by_offset`, `find_sentence_index_by_word`, `attach_scroll_controller`, `create_highlight_renderer`, and the DOM helpers — they're all internals of `create_view`.

## Acceptance criteria

- [x] `src/lib/view/index.svelte.ts` is created and exports `create_view`.
- [x] All DOM/Range helpers (`get_passage_text_node`, `make_range`, `get_caret_offset`, `get_active_word_rect`) live inside the view module — not in `+page.svelte`.
- [x] The view subscribes to playback via the `PlaybackView` interface; it does not receive `word_index` as a callback parameter from the route.
- [x] `+page.svelte` no longer imports `attach_scroll_controller`, `create_highlight_renderer`, `find_sentence_index_by_offset`, `find_sentence_index_by_word`, `RendererView`, or anything from `$lib/highlight/svg_overlay` except for whatever CSS variable references survive in markup.
- [x] `+page.svelte` has at most one `$effect` block that creates the view controller.
- [x] The route's `hovered_sentence_index`, `view`, `snap_back_visible`, `renderer`, `scroll_controller` `$state` variables are deleted; reads come from `view.*` getters.
- [ ] Unit tests cover `sentence_at`, `seek_target_word_at` (both happy path and "click outside text" returning null), and the `snap_back_visible` reactive read under fake scroll states.
- [x] `npx vitest run` is green.
- [ ] Playwright `autoscroll.spec.ts` still passes — the user-idle yield and snap-back affordance behave identically.
- [ ] Manual smoke at `/`: hover changes the sentence highlight, click-to-seek lands on the right sentence, scroll up shows the snap-back button after user-idle time, snap-back jumps back to the active word.

## Blocked by

- `01-delete-highlight-api-render-path` — so the view doesn't have to host both render paths.
- `04-extract-create-playback-controller` — so the view can be coupled to playback's getters.
