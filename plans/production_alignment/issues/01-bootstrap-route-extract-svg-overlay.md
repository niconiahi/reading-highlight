# 01 — Bootstrap `/production` route and extract shared SVG-overlay geometry

Type: AFK
Triage: ready-for-agent

## Parent

`plans/production_alignment/PRD.md`

## What to build

Stand up a new `/production` route that renders the same passage and the same highlight visuals as `/speechify/range-rects`, so that subsequent slices have a place to land production-readiness behavior without touching the baseline.

To avoid copy-pasting geometry between the two routes, extract the SVG-overlay pipeline from the baseline into a shared `$lib/highlight/svg_overlay` module: `build_outline_path`, `get_local_line_rects`, `build_rounded_rect_path`, and the rect-padding constants. The baseline imports from the new module instead of declaring them inline. Visual behavior of the baseline is unchanged.

`/production` reuses the existing `$lib/load_passage` seam unchanged. The route's `+page.svelte` is the smallest reader shell that loads the passage, plays the bundled audio, and renders the three highlight layers (hover, active sentence, current word) — nothing more. Subsequent slices add production behaviors on top.

## Acceptance criteria

- [ ] Navigating to `/production` renders the same passage as `/speechify/range-rects`.
- [ ] The three highlight layers (hover sentence, active sentence, current word) render identically to the baseline at the same time offsets.
- [ ] Click-to-seek works on `/production` exactly as it does on the baseline.
- [ ] Both routes import the SVG-overlay helpers from `$lib/highlight/svg_overlay` — no duplicated geometry code.
- [ ] The baseline route's behavior is unchanged (manual smoke check + existing tests still pass).
- [ ] The new module is covered by at least one unit test for `build_rounded_rect_path` (pure function, no DOM).

## Blocked by

None — can start immediately.
