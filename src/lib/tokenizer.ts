export type WordRange = readonly [start: number, end: number];

export type SentenceRange = {
  start: number;
  end: number;
  first_word_index: number;
  last_word_index: number;
};

export function find_sentence_index_by_offset(
  sentences: SentenceRange[],
  offset: number,
): number {
  let prev = -1;
  for (let i = 0; i < sentences.length; i++) {
    if (offset < sentences[i].start) return prev;
    if (offset < sentences[i].end) return i;
    prev = i;
  }
  return prev;
}

export function find_sentence_index_by_word(
  sentences: SentenceRange[],
  word_index: number,
): number {
  for (let i = 0; i < sentences.length; i++) {
    if (
      word_index >= sentences[i].first_word_index &&
      word_index <= sentences[i].last_word_index
    ) {
      return i;
    }
  }
  return -1;
}
