import { logger } from '$lib/telemetry';

export type MediaSessionConfig = {
  title: string;
  artist: string;
  on_prev_sentence: () => void;
  on_next_sentence: () => void;
};

export type MediaSessionController = {
  teardown: () => void;
};

const SEEK = 10;
const NOOP: MediaSessionController = { teardown: () => {} };

export function attach_media_session(
  audio_el: HTMLAudioElement,
  config: MediaSessionConfig,
): MediaSessionController {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return NOOP;
  const ms = navigator.mediaSession;

  if (typeof MediaMetadata !== 'undefined') {
    ms.metadata = new MediaMetadata({ title: config.title, artist: config.artist });
  }

  const log = (action: string) => logger.event('media_session.action', { action });
  const handlers: Record<string, () => void> = {
    play: () => { log('play'); void audio_el.play(); },
    pause: () => { log('pause'); audio_el.pause(); },
    seekbackward: () => {
      log('seekbackward');
      audio_el.currentTime = Math.max(0, audio_el.currentTime - SEEK);
    },
    seekforward: () => {
      log('seekforward');
      const dur = Number.isFinite(audio_el.duration) ? audio_el.duration : 0;
      const next = audio_el.currentTime + SEEK;
      audio_el.currentTime = dur > 0 ? Math.min(dur, next) : next;
    },
    previoustrack: () => { log('previoustrack'); config.on_prev_sentence(); },
    nexttrack: () => { log('nexttrack'); config.on_next_sentence(); },
  };

  for (const [action, handler] of Object.entries(handlers)) {
    try {
      ms.setActionHandler(action as MediaSessionAction, handler);
    } catch {
      // Older browsers may reject unknown action types.
    }
  }

  const update_position = () => {
    if (typeof ms.setPositionState !== 'function') return;
    const dur = Number.isFinite(audio_el.duration) ? audio_el.duration : 0;
    try {
      ms.setPositionState({
        duration: dur,
        playbackRate: audio_el.playbackRate || 1,
        position: Math.max(0, Math.min(audio_el.currentTime, dur || audio_el.currentTime)),
      });
    } catch {
      // setPositionState rejects some duration/position combos during load.
    }
  };
  const events = ['play', 'pause', 'seeked', 'ratechange', 'loadedmetadata'] as const;
  for (const e of events) audio_el.addEventListener(e, update_position);

  return {
    teardown() {
      for (const action of Object.keys(handlers)) {
        try { ms.setActionHandler(action as MediaSessionAction, null); } catch {}
      }
      ms.metadata = null;
      for (const e of events) audio_el.removeEventListener(e, update_position);
    },
  };
}
