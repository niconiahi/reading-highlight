import "../../chunks/index-server.js";
import { _ as attr, i as stringify, t as attr_style, v as escape_html } from "../../chunks/server.js";
import "@opentelemetry/api-logs";
import "@opentelemetry/sdk-logs";
import "@opentelemetry/resources";
//#endregion
//#region src/routes/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		let svg = {
			overlay_w: 0,
			overlay_h: 0,
			path_hover: "",
			path_active: "",
			path_word: ""
		};
		function fmt(t) {
			if (!Number.isFinite(t)) return "0:00";
			return `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, "0")}`;
		}
		$$renderer.push(`<div class="reader svelte-1uha8ag"><article class="doc"><div class="passage-wrap svelte-1uha8ag"><div class="overlay svelte-1uha8ag" aria-hidden="true"><svg class="layer hover svelte-1uha8ag"${attr("viewBox", `-${stringify(10)} -${stringify(10)} ${stringify(svg.overlay_w)} ${stringify(svg.overlay_h)}`)} preserveAspectRatio="none"><path${attr("d", svg.path_hover)} class="svelte-1uha8ag"></path></svg> <svg class="layer active svelte-1uha8ag"${attr("viewBox", `-${stringify(10)} -${stringify(10)} ${stringify(svg.overlay_w)} ${stringify(svg.overlay_h)}`)} preserveAspectRatio="none"><path${attr("d", svg.path_active)} class="svelte-1uha8ag"></path></svg> <svg class="layer word svelte-1uha8ag"${attr("viewBox", `-${stringify(10)} -${stringify(10)} ${stringify(svg.overlay_w)} ${stringify(svg.overlay_h)}`)} preserveAspectRatio="none"><path${attr("d", svg.path_word)} class="svelte-1uha8ag"></path></svg></div>  <div class="passage svelte-1uha8ag" aria-live="off"><span class="passage-text">${escape_html(data.text)}</span></div></div> <span class="sr-only" aria-live="polite">${escape_html((data.ranges.length, ""))}</span></article> <div class="player" role="group" aria-label="Audio player"><audio${attr("src", data.audio_url)} preload="auto"></audio> <div class="progress-row"><span class="t">${escape_html(fmt(0))}</span> <div class="progress" role="slider" tabindex="0" aria-valuemin="0"${attr("aria-valuemax", 0)}${attr("aria-valuenow", 0)}><div class="bar"${attr_style("", { width: `${stringify(0)}%` })}></div></div> <span class="t">${escape_html(fmt(0))}</span></div> <div class="controls"><button class="ctrl" type="button">−10s</button> <button class="play" type="button">${escape_html("▶")}</button> <button class="ctrl" type="button">+10s</button> <button class="rate" type="button">${escape_html(1)}×</button></div></div></div>`);
	});
}
//#endregion
export { _page as default };
