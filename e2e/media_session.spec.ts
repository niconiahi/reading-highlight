import { expect, test } from '@playwright/test';
import { block_external_audio } from './helpers';

test.describe('/ media session integration', () => {
  test.beforeEach(async ({ page }) => {
    await block_external_audio(page);
    await page.goto('/');
    await page.waitForSelector('.passage-text');
  });

  // Q: After mount, did the route populate navigator.mediaSession.metadata
  //    with the document's title + artist? Without metadata the lockscreen /
  //    headphone overlay shows "Unknown" — the whole point of attaching.
  test('mount sets MediaMetadata with title and artist', async ({ page }) => {
    await page.waitForFunction(
      () => navigator.mediaSession?.metadata?.title !== '',
    );
    const meta = await page.evaluate(() => ({
      title: navigator.mediaSession.metadata?.title ?? null,
      artist: navigator.mediaSession.metadata?.artist ?? null,
    }));
    expect(meta.title).toBe('Abou Ben Adhem');
    expect(meta.artist).toBe('Leigh Hunt');
  });
});
