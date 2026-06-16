// One-shot: enrich static/abou-ben-adhem.json with word ranges + sentence ranges.
// Run after whisper produces a fresh JSON. `node whisper/bake.mjs`.
import { readFileSync, writeFileSync } from 'node:fs';

const PATH = new URL('../static/abou-ben-adhem.json', import.meta.url);
const data = JSON.parse(readFileSync(PATH, 'utf8'));

const ranges = [];
let cursor = 0;
for (const w of data.words) {
  const found = data.text.indexOf(w.text, cursor);
  if (found < 0) continue;
  ranges.push([found, found + w.text.length]);
  cursor = found + w.text.length;
}

const sentences = [];
const seg = new Intl.Segmenter('en', { granularity: 'sentence' });
for (const s of seg.segment(data.text)) {
  const start = s.index;
  const raw_end = s.index + s.segment.length;
  const trimmed = s.segment.replace(/\s+$/, '');
  if (!trimmed.length) continue;
  const end = start + trimmed.length;
  let first = -1, last = -1;
  for (let i = 0; i < ranges.length; i++) {
    const [ws, we] = ranges[i];
    if (we <= start) continue;
    if (ws >= raw_end) break;
    if (first < 0) first = i;
    last = i;
  }
  if (first < 0) continue;
  sentences.push({ start, end, first_word_index: first, last_word_index: last });
}

writeFileSync(PATH, JSON.stringify({ ...data, ranges, sentences }, null, 2));
console.log(`baked ${ranges.length} ranges, ${sentences.length} sentences`);
