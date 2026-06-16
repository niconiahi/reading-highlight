# 02 — Delete the latency calibration UI and module

Type: AFK
Triage: ready-for-agent

## Parent

`plans/improvements/PRD.md`

## What to build

Real reader products do not expose a manual latency calibration affordance — the chrome is play/pause + skip + rate. Our calibration module (the "tap when you hear the beep" flow) is ~120 lines of code plus tests plus a route button block plus a persistence column, and the automatic latency measurement (`AudioContext.outputLatency` + `baseLatency`) already handles the dominant source of audio-graph drift. The manual offset only mattered for a long tail of cases the browser can't see (some Bluetooth codecs), and the prototype's accuracy never warranted shipping the UI.

Delete `$lib/latency/calibration.ts` and `calibration.test.ts`. Remove `calibration_scheduled` and `manual_offset_ms_display` from the route, the `.calibration` markup div and its `data-offset-ms` attribute, the calibrate / "Tap when you hear the beep" buttons, and the associated CSS. Drop the `manual_offset_ms` field from the persistence schema and from `attach_session_persistence`'s read/write surface. Shrink `attach_latency_measurement` to no longer expose `get_manual_offset_ms` / `set_manual_offset_ms`; it returns only the automatic `output_latency` + `base_latency` total in seconds.

Keep the automatic latency feedback into the word-index search untouched — that's what makes the highlight track tight without user input.

## Acceptance criteria

- [x] `src/lib/latency/calibration.ts` and `calibration.test.ts` are deleted.
- [x] `attach_latency_measurement`'s returned controller no longer exposes manual-offset getters/setters.
- [x] `+page.svelte` has no `calibration` import, no `create_calibration` call, no `calibration_scheduled` or `manual_offset_ms_display` state, no calibrate button markup, and no `.calibration` CSS.
- [x] `attach_session_persistence` no longer reads or writes `manual_offset_ms`.
- [x] The persistence record type drops the `manual_offset_ms` field. Existing IDB records with the field deserialize without crashing (extra fields are ignored).
- [x] `npx vitest run` is green.
- [x] Playwright `latency.spec.ts` still passes (the auto-latency path is the part it actually exercises). If it asserts on calibration UX specifically, rewrite to drop those assertions.
- [ ] Manual smoke: navigate to `/`, confirm no calibrate button is rendered and that the highlight still tracks the audio with `outputLatency` alone.

## Blocked by

None — can start immediately.
