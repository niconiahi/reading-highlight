# 06 — User-vs-programmatic scroll yield with snap-back affordance

Type: AFK
Triage: ready-for-agent

## Parent

`plans/production_alignment/PRD.md`

## What to build

Make the existing auto-scroll-to-current-word effect on `/production` yield to the user when the user is actively scrolling. Detection is by event presence, not by trying to distinguish programmatic scroll from user scroll (events overlap and that comparison is unreliable).

Wire `wheel`, `touchstart`, and `keydown` (arrows, PgUp, PgDn, space) listeners on the scroll root. On any of those, set `user_scroll_idle_since = Date.now()`. The programmatic `scrollBy` in the autoscroll effect is gated by a pure predicate `should_autoscroll({ now, user_scroll_idle_since, threshold_ms })` from a new `$lib/playback/should_autoscroll` module. Default threshold: 4000 ms.

Add a "snap back to highlight" button that is visible whenever the active word's bounding rect is outside the scroll root's visible area. Clicking it immediately scrolls to the current word and clears the user-scroll flag (opting back into auto-scroll).

Emit `autoscroll.yielded` when the predicate suppresses a programmatic scroll, and `autoscroll.snapped_back` when the user clicks the snap-back button.

## Acceptance criteria

- [ ] `$lib/playback/should_autoscroll` is a pure function; table-driven unit tests cover `(scrolled recently → false)`, `(scrolled long ago → true)`, `(never scrolled → true)`.
- [ ] `/production` registers `wheel`, `touchstart`, `keydown` listeners on the scroll root.
- [ ] Playwright: scroll up while audio is playing; assert no programmatic scroll happens for 4 s after the scroll event.
- [ ] Playwright: after 4 s of scroll idle, programmatic scroll resumes on the next word boundary.
- [ ] Snap-back button is present when the active word is off-screen and hidden when on-screen.
- [ ] Telemetry events fire as specified; recording-sink test asserts the sequence during a scripted scroll-then-idle scenario.

## Blocked by

- 01 — bootstrap-route-extract-svg-overlay
