import { attach_keybindings } from './keybindings';
import { attach_media_session } from '$lib/media_session';
import { logger } from '$lib/telemetry';
import {
  find_sentence_index_by_word,
  type SentenceRange,
} from '$lib/tokenizer';

const RATES: readonly number[] = [0.75, 1, 1.25, 1.5, 2];

const safe_duration = (el: HTMLAudioElement) =>
  Number.isFinite(el.duration) ? el.duration : 0;

export type PlaybackController = ReturnType<typeof create_playback>;

export function create_playback(
  audio_el: HTMLAudioElement,
  { timings, sentences, title, artist }: {
    timings: readonly { start: number }[];
    sentences: readonly SentenceRange[];
    title: string;
    artist: string;
  },
) {
  let playing = $state(!audio_el.paused);
  let current_time = $state(audio_el.currentTime);
  let duration = $state(safe_duration(audio_el));
  let rate = $state(1);
  let muted = $state(audio_el.muted);
  let volume = $state(audio_el.volume);
  let word_index = $state(0);
  let seek_count = 0;
  let max_position = 0;
  let played_first = false;

  audio_el.playbackRate = 1;
  audio_el.preservesPitch = true;

  const on_play = () => {
    playing = true;
    if (!played_first) {
      played_first = true;
      logger.event('audio.first_play', { at: audio_el.currentTime });
    }
  };
  const on_pause = () => (playing = false);
  const on_metadata = () => {
    duration = safe_duration(audio_el);
  };
  const on_ended = () => logger.event('audio.ended', { duration });
  const on_error = () => {
    const code = audio_el.error?.code ?? 0;
    logger.event('audio.error', { code, src: audio_el.currentSrc });
  };
  const on_waiting = () => logger.event('audio.waiting', { at: audio_el.currentTime });
  const on_canplaythrough = () => logger.event('audio.canplaythrough', { duration });
  const on_volumechange = () => {
    muted = audio_el.muted;
    volume = audio_el.volume;
  };
  audio_el.addEventListener('play', on_play);
  audio_el.addEventListener('pause', on_pause);
  audio_el.addEventListener('loadedmetadata', on_metadata);
  audio_el.addEventListener('ended', on_ended);
  audio_el.addEventListener('error', on_error);
  audio_el.addEventListener('waiting', on_waiting);
  audio_el.addEventListener('canplaythrough', on_canplaythrough);
  audio_el.addEventListener('volumechange', on_volumechange);

  let raf = 0;
  const tick = () => {
    current_time = audio_el.currentTime;
    if (current_time > max_position) max_position = current_time;
    // ponytail: linear scan; passage is ~150 words. Binary search if it grows past ~10k.
    if (timings.length) {
      const i = timings.findLastIndex((w) => w.start <= current_time);
      word_index = i < 0 ? 0 : i;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  function toggle_play(): void {
    if (audio_el.paused) void audio_el.play();
    else audio_el.pause();
  }

  function seek(time_seconds: number, source: string = 'api'): void {
    const dur = safe_duration(audio_el);
    const upper = dur > 0 ? Math.min(dur, time_seconds) : time_seconds;
    const from = audio_el.currentTime;
    const to = Math.max(0, upper);
    audio_el.currentTime = to;
    seek_count++;
    logger.event('playback.seek', { source, from, to });
  }

  function seek_to_word(idx: number, source: string = 'api'): void {
    const w = timings[idx];
    if (w) seek(w.start, source);
  }

  function seek_to_sentence(sentence_index: number, source: string): void {
    const s = sentences[sentence_index];
    if (s) seek_to_word(s.first_word_index, source);
  }

  function skip(delta_seconds: number, source: string = 'api'): void {
    seek(audio_el.currentTime + delta_seconds, source);
  }

  function set_rate(value: number): void {
    rate = value;
    audio_el.playbackRate = value;
    logger.event('playback.rate_changed', { rate: value });
  }

  function cycle_rate(): void {
    set_rate(RATES[(RATES.indexOf(rate) + 1) % RATES.length]);
  }

  const media_session = attach_media_session(audio_el, {
    title,
    artist,
    on_prev_sentence: () => {
      const s = find_sentence_index_by_word(sentences as SentenceRange[], word_index);
      seek_to_sentence(Math.max(0, s - 1), 'media_session');
    },
    on_next_sentence: () => {
      const s = find_sentence_index_by_word(sentences as SentenceRange[], word_index);
      seek_to_sentence(s + 1, 'media_session');
    },
  });

  const keybindings_teardown = attach_keybindings({
    on_toggle_play: toggle_play,
    on_skip: (d) => skip(d, 'keyboard'),
  });

  function session_summary(): void {
    const dur = safe_duration(audio_el);
    logger.event('playback.session_summary', {
      max_position,
      seek_count,
      completed: dur > 0 ? max_position / dur : 0,
    });
  }

  function teardown(): void {
    session_summary();
    cancelAnimationFrame(raf);
    media_session.teardown();
    keybindings_teardown();
    audio_el.removeEventListener('play', on_play);
    audio_el.removeEventListener('pause', on_pause);
    audio_el.removeEventListener('loadedmetadata', on_metadata);
    audio_el.removeEventListener('ended', on_ended);
    audio_el.removeEventListener('error', on_error);
    audio_el.removeEventListener('waiting', on_waiting);
    audio_el.removeEventListener('canplaythrough', on_canplaythrough);
    audio_el.removeEventListener('volumechange', on_volumechange);
  }

  return {
    toggle_play,
    seek,
    seek_to_word,
    skip,
    cycle_rate,
    set_rate,
    get playing() { return playing; },
    get current_time() { return current_time; },
    get duration() { return duration; },
    get rate() { return rate; },
    get word_index() { return word_index; },
    get audible() { return playing && !muted && volume > 0; },
    get active_sentence_index() {
      return find_sentence_index_by_word(sentences as SentenceRange[], word_index);
    },
    teardown,
  };
}
