import { t as get_sentence_ranges } from "../../chunks/tokenizer.js";
//#region src/routes/+page.ts
var AUDIO_URL = "https://archive.org/download/short_poetry_001_librivox/abou_hunt_py_64kb.mp3";
var JSON_URL = "/abou-ben-adhem.json";
var load = async ({ fetch }) => {
	const data = await (await fetch(JSON_URL)).json();
	const ranges = [];
	let cursor = 0;
	for (const w of data.words) {
		const found = data.text.indexOf(w.text, cursor);
		if (found < 0) continue;
		ranges.push([found, found + w.text.length]);
		cursor = found + w.text.length;
	}
	return {
		text: data.text,
		timings: data.words,
		ranges,
		sentences: get_sentence_ranges(data.text, ranges),
		audio_url: AUDIO_URL
	};
};
//#endregion
export { load };
