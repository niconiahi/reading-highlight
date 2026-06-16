// @ts-nocheck
import type { PageLoad } from './$types';
import { logger } from '$lib/telemetry';

const AUDIO_URL =
  'https://archive.org/download/short_poetry_001_librivox/abou_hunt_py_64kb.mp3';
const JSON_URL = '/abou-ben-adhem.json';

export const load = async ({ fetch }: Parameters<PageLoad>[0]) => {
  const t0 = performance.now();
  try {
    const res = await fetch(JSON_URL);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    logger.event('load.fetched', {
      url: JSON_URL,
      duration_ms: Math.round(performance.now() - t0),
    });
    return {
      text: data.text,
      timings: data.words,
      ranges: data.ranges,
      sentences: data.sentences,
      audio_url: AUDIO_URL,
    };
  } catch (err) {
    logger.event('load.failed', {
      stage: 'json',
      url: JSON_URL,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
};
