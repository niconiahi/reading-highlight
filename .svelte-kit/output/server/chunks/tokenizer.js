//#region src/lib/tokenizer.ts
function get_sentence_ranges(text, word_ranges) {
	const out = [];
	const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
	for (const segment of segmenter.segment(text)) {
		const start = segment.index;
		const raw_end = segment.index + segment.segment.length;
		const trimmed = segment.segment.replace(/\s+$/, "");
		if (!trimmed.length) continue;
		const end = start + trimmed.length;
		let first = -1;
		let last = -1;
		for (let i = 0; i < word_ranges.length; i++) {
			const [ws, we] = word_ranges[i];
			if (we <= start) continue;
			if (ws >= raw_end) break;
			if (first < 0) first = i;
			last = i;
		}
		if (first < 0) continue;
		out.push({
			start,
			end,
			first_word_index: first,
			last_word_index: last
		});
	}
	return out;
}
//#endregion
export { get_sentence_ranges as t };
