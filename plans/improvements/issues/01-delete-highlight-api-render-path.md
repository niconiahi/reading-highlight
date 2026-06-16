# 01 — Delete the Highlight API render path; SVG-only renderer

Type: AFK
Triage: ready-for-agent

## Parent

`plans/improvements/PRD.md`

## What to build

The `/` route currently detects whether the browser supports the CSS Custom Highlight API (`CSS.highlights`) and renders highlights through `::highlight(active)` / `::highlight(hover)` / `::highlight(word)` when available, falling back to the SVG-overlay pipeline otherwise. In practice the SVG fallback already works on every browser that supports the Highlight API (Chrome 105+), so the dual path adds branching, capability-detection ceremony, and a handful of injectable constructors to `create_highlight_renderer` for no visible benefit.

Collapse `create_highlight_renderer` to the SVG path only. Delete `$lib/highlight/render_path.ts` and its tests. The route no longer carries a `render_path` `$state`, no longer probes the `window` for capabilities, and no longer renders the `::highlight(...)` global CSS rules. The `data-render-path` attribute on `.passage-wrap` goes away. The renderer's config shrinks to `{ passage_el, on_view_change }` — the previously-injectable `resize_observer_ctor`, `window_target`, `css_highlight_registry`, `highlight_ctor`, and `make_range` become module-level defaults using real DOM (override-via-setter only if a test still needs it).

## Acceptance criteria

- [x] `src/lib/highlight/render_path.ts` and its `.test.ts` are deleted.
- [x] `src/lib/highlight/renderer.ts` exports a single SVG implementation; no `render_path` branch.
- [x] `create_highlight_renderer`'s public config is `{ passage_el, on_view_change }` — no injectable constructors.
- [x] `+page.svelte` no longer imports anything from `$lib/highlight/render_path`, has no `render_path` `$state`, and does not call `detect_highlight_render_path` or `probe_window`.
- [x] `+page.svelte` no longer wraps the SVG overlay in `{#if render_path === 'svg_overlay'}`. The overlay is unconditionally rendered.
- [x] The route style block no longer contains the `:global(::highlight(...))` rules.
- [x] `e2e/highlight_render_path.spec.ts` is deleted or rewritten to assert "SVG overlay always renders".
- [x] `npx vitest run` is green.
- [ ] Manual smoke: navigate to `/`, confirm the highlight visuals are unchanged from before.

## Blocked by

None — can start immediately.
