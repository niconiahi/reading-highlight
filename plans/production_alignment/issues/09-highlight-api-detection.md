# 09 — Highlight API capability detection with SVG fallback

Type: AFK
Triage: ready-for-agent

## Parent

`plans/production_alignment/PRD.md`

## What to build

On `/production`, render the three highlight layers (hover sentence, active sentence, current word) via the CSS Custom Highlight API when the browser supports it, and fall back to the SVG-overlay path (from slice 01) when it doesn't.

Capability detection: `'highlights' in CSS` on mount. If true:

- Create named `Highlight` instances for `hover`, `active`, `word`.
- Register them via `CSS.highlights.set('hover', h_hover)` etc.
- Style them via `::highlight(hover)`, `::highlight(active)`, `::highlight(word)` in the route stylesheet.
- Update the highlight ranges (`Range` objects against the passage text node) reactively when the active word / hovered sentence / playing sentence change.

If false, the route renders the SVG overlay exactly as the baseline does, using the shared `$lib/highlight/svg_overlay` module.

Both paths must produce visually equivalent results for a sighted user on the bundled passage. The Highlight API path does not use `box-decoration-break`; collisions with page styles are avoided by detection-only naming (no hostile CSS in this prototype, but the discipline carries to the extension surface later).

Emit `highlight.render_path` once on mount with `{ path: "css_highlight_api" | "svg_overlay" }`.

## Acceptance criteria

- [ ] `/production` detects Highlight API support on mount and branches rendering accordingly.
- [ ] On a Chromium browser (supports the API), the three highlights render via `::highlight(...)`.
- [ ] On a forced-fallback test (capability stubbed to `false`), the three highlights render via SVG overlay and look indistinguishable from the API path on the bundled passage.
- [ ] No visible regression from baseline for hover-sentence, active-sentence, or current-word.
- [ ] Playwright tests cover both branches via a test hook that forces the fallback path.
- [ ] Telemetry event `highlight.render_path` fires exactly once on mount with the chosen branch.

## Blocked by

- 01 — bootstrap-route-extract-svg-overlay
- 02 — telemetry-sink-seam
