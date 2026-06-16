<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import {
    BLEED,
    SENTENCE_RADIUS,
    WORD_RADIUS,
    get_local_line_rects,
    type RectLike,
  } from '$lib/highlight/svg_overlay';
  import { logger } from '$lib/telemetry';
  import {
    create_playback,
    type PlaybackController,
  } from '$lib/playback/index.svelte';
  import { find_sentence_index_by_offset } from '$lib/tokenizer';
  import type { PageData } from './$types';

  const STORAGE_KEY = 'reading-highlight:abou-ben-adhem';
  const TITLE = 'Abou Ben Adhem';
  const ARTIST = 'Leigh Hunt';

  let { data }: { data: PageData } = $props();

  if (browser && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  let audio_el = $state<HTMLAudioElement | undefined>(undefined);
  let passage_el = $state<HTMLElement | undefined>(undefined);
  let playback = $state<PlaybackController | null>(null);
  let hover_sentence = $state(-1);
  let passage_rect = $state({ left: 0, top: 0, width: 0, height: 0 });
  const overlay_w = $derived(passage_rect.width + BLEED * 2);
  const overlay_h = $derived(passage_rect.height + BLEED * 2);
  const origin = $derived({ x: passage_rect.left, y: passage_rect.top });

  onMount(() => logger.event('route.mounted', { route: '/' }));

  $effect(() => {
    if (!audio_el || !passage_el) return;
    const p = create_playback(audio_el, {
      timings: data.timings,
      sentences: data.sentences,
      title: TITLE,
      artist: ARTIST,
    });
    playback = p;

    const observer = new ResizeObserver(() => {
      if (!passage_el) return;
      const r = passage_el.getBoundingClientRect();
      passage_rect = { left: r.left, top: r.top, width: r.width, height: r.height };
    });
    observer.observe(passage_el);

    const on_err = (e: ErrorEvent) => {
      logger.event('error.unhandled', { message: e.message, src: e.filename });
    };
    const on_rej = (e: PromiseRejectionEvent) => {
      logger.event('error.unhandled', { message: String(e.reason) });
    };
    window.addEventListener('error', on_err);
    window.addEventListener('unhandledrejection', on_rej);

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const s = raw ? (JSON.parse(raw) as { position?: number; rate?: number }) : null;
      if (s && typeof s.rate === 'number') p.set_rate(s.rate);
      if (s && typeof s.position === 'number') p.seek(s.position);
      logger.event('state.restored', {
        had_state: !!s,
        rate: s?.rate ?? 0,
        position: s?.position ?? 0,
      });
    } catch {
      // ignore corrupt/disabled storage
    }

    const on_pagehide = () => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ position: p.current_time, rate: p.rate }),
        );
        logger.event('state.persisted', { position: p.current_time, rate: p.rate });
      } catch {
        // ignore
      }
    };
    window.addEventListener('pagehide', on_pagehide);

    return () => {
      window.removeEventListener('pagehide', on_pagehide);
      window.removeEventListener('error', on_err);
      window.removeEventListener('unhandledrejection', on_rej);
      observer.disconnect();
      p.teardown();
      playback = null;
    };
  });

  function text_node(): Text | null {
    const first = passage_el?.querySelector('.passage')?.firstChild;
    return first instanceof Text ? first : null;
  }

  const rects_hover = $derived.by<RectLike[]>(() => {
    const tn = passage_el && text_node();
    if (!tn || hover_sentence < 0) return [];
    const s = data.sentences[hover_sentence];
    return get_local_line_rects(tn, s.start, s.end, origin);
  });

  const rects_active = $derived.by<RectLike[]>(() => {
    const tn = passage_el && text_node();
    if (!tn || !playback) return [];
    const i = playback.active_sentence_index;
    if (i < 0) return [];
    const s = data.sentences[i];
    return get_local_line_rects(tn, s.start, s.end, origin);
  });

  const rects_word = $derived.by<RectLike[]>(() => {
    const tn = passage_el && text_node();
    if (!tn || !playback) return [];
    const wr = data.ranges[playback.word_index];
    if (!wr) return [];
    return get_local_line_rects(tn, wr[0], wr[1], origin);
  });

  function fmt(t: number): string {
    if (!Number.isFinite(t)) return '0:00';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  const cur = $derived(playback?.current_time ?? 0);
  const dur = $derived(playback?.duration ?? 0);
  const fill_pct = $derived(dur ? (cur / dur) * 100 : 0);

  function iso(t: number): string {
    if (!Number.isFinite(t) || t <= 0) return 'PT0S';
    return `PT${Math.floor(t / 60)}M${Math.floor(t % 60)}S`;
  }

  function sentence_at(e: MouseEvent): number {
    const tn = text_node();
    if (!tn) return -1;
    const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
    if (!pos || pos.offsetNode !== tn) return -1;
    return find_sentence_index_by_offset(data.sentences, pos.offset);
  }

  function on_passage_click(e: MouseEvent): void {
    const s_idx = sentence_at(e);
    if (s_idx < 0) return;
    logger.event('passage.sentence_seek', { sentence_index: s_idx });
    playback?.seek_to_word(data.sentences[s_idx].first_word_index, 'sentence');
  }

  function scrub(e: Event): void {
    const v = parseFloat((e.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    playback?.seek(v, 'scrub');
  }
</script>

<main class="reader">
  <article class="doc">
    <div class="passage-wrap" bind:this={passage_el}>
      <svg
        class="overlay"
        viewBox="-{BLEED} -{BLEED} {overlay_w} {overlay_h}"
        preserveAspectRatio="none"
        width={overlay_w}
        height={overlay_h}
        aria-hidden="true"
      >
        {#each rects_hover as r}
          <rect class="hover" x={r.left} y={r.top} width={r.width} height={r.height} rx={SENTENCE_RADIUS} ry={SENTENCE_RADIUS} />
        {/each}
        {#each rects_active as r}
          <rect class="active" x={r.left} y={r.top} width={r.width} height={r.height} rx={SENTENCE_RADIUS} ry={SENTENCE_RADIUS} />
        {/each}
        {#each rects_word as r}
          <rect class="word" x={r.left} y={r.top} width={r.width} height={r.height} rx={WORD_RADIUS} ry={WORD_RADIUS} />
        {/each}
      </svg>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <blockquote
        class="passage"
        cite="https://en.wikisource.org/wiki/Abou_Ben_Adhem"
        onclick={on_passage_click}
        onmousemove={(e) => (hover_sentence = sentence_at(e))}
        onmouseleave={() => (hover_sentence = -1)}
      >{data.text}</blockquote>
    </div>

    <span class="sr-only" aria-live="polite">
      {!playback || playback.audible || !data.ranges.length
        ? ''
        : data.text.slice(data.ranges[playback.word_index][0], data.ranges[playback.word_index][1])}
    </span>
  </article>

  <section class="player" aria-label="Audio player">
    <audio bind:this={audio_el} src={data.audio_url} preload="auto"></audio>
    <div class="progress-row">
      <time class="t" datetime={iso(cur)}>{fmt(cur)}</time>
      <input
        class="progress"
        type="range"
        min="0"
        max={dur || 0}
        step="0.1"
        value={cur}
        oninput={scrub}
        aria-label="Seek"
        style:--fill="{fill_pct}%"
      />
      <time class="t" datetime={iso(dur)}>{fmt(dur)}</time>
    </div>
    <div class="controls">
      <button class="ctrl" onclick={() => playback?.skip(-10, 'button')} type="button" aria-label="Skip back 10 seconds">−10s</button>
      <button
        class="play"
        onclick={() => playback?.toggle_play()}
        type="button"
        aria-label={playback?.playing ? 'Pause' : 'Play'}
      >{playback?.playing ? '❚❚' : '▶'}</button>
      <button class="ctrl" onclick={() => playback?.skip(10, 'button')} type="button" aria-label="Skip forward 10 seconds">+10s</button>
      <button class="rate" onclick={() => playback?.cycle_rate()} type="button" aria-label="Playback rate">{playback?.rate ?? 1}×</button>
    </div>
  </section>
</main>

<style>
  .passage-wrap { position: relative; }
  .overlay { position: absolute; top: -10px; left: -10px; pointer-events: none; overflow: visible; max-width: none; }
  .overlay :global(.hover) { fill: var(--highlight-sentence-hover); }
  .overlay :global(.active) { fill: var(--highlight-sentence); }
  .overlay :global(.word) { fill: var(--highlight-word); }
  .reader .passage { position: relative; }
</style>
