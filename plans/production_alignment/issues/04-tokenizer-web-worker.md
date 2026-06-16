# 04 — Tokenizer Web Worker

Type: AFK
Triage: ready-for-agent

## Parent

`plans/production_alignment/PRD.md`

## What to build

Move `Intl.Segmenter`-based tokenization off the main thread for `/production`. A new `$lib/tokenizer.worker.ts` module hosts the existing tokenizer logic (sentence ranges + word ranges) and runs as a module worker. The main thread posts text + word ranges; the worker posts back `{ sentences, word_ranges }`.

`$lib/load_passage` gains a `tokenize` strategy parameter — `"inline"` (current behavior, used by `/speechify/range-rects`) or `"worker"` (new, used by `/production`). Behavior is otherwise identical.

On large documents the main thread must remain responsive during tokenization. Verify with a Playwright smoke that simulates a 50k-word passage and asserts the main thread is not blocked for more than a small budget (e.g. 50 ms) during the load.

## Acceptance criteria

- [ ] `$lib/tokenizer.worker.ts` exists and accepts `{ text, word_ranges }`, posts back `{ sentences, word_ranges }`.
- [ ] Worker module's pure handler is unit-tested directly (no worker setup needed for unit tests).
- [ ] `$lib/load_passage` accepts a `tokenize: "inline" | "worker"` option, default `"inline"`.
- [ ] `/production` uses `tokenize: "worker"`; `/speechify/range-rects` continues to use `"inline"`.
- [ ] Playwright smoke loads `/production` with a synthesized large passage and asserts the main thread stays responsive (no long task > 50 ms attributable to tokenization).
- [ ] Telemetry event `tokenize.completed` is emitted with `{ strategy: "worker", duration_ms: number }` on completion.

## Blocked by

- 01 — bootstrap-route-extract-svg-overlay
