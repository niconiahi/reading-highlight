import { expect, test, type Page } from '@playwright/test';
import { block_external_audio } from './helpers';

const KEY = 'reading-highlight:abou-ben-adhem';

async function read_stored(page: Page) {
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as { position: number; rate: number }) : null;
  }, KEY);
}

async function write_stored(page: Page, state: { position: number; rate: number }) {
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(state)] as const);
}

test.describe('/ (production reader) persistence', () => {
  test.beforeEach(async ({ page }) => {
    await block_external_audio(page);
    await page.goto('/');
    await page.evaluate((k) => localStorage.removeItem(k), KEY);
  });

  // Q: Does dispatching `pagehide` actually drive the route to write the
  //    current position and rate into localStorage? We poke the route's state
  //    through its own UI (rate button) and through audio.currentTime, then
  //    read storage directly to confirm.
  test('pagehide persists position and rate into localStorage', async ({ page }) => {
    await page.evaluate(() => {
      const a = document.querySelector('audio') as HTMLAudioElement;
      a.currentTime = 7.5;
    });
    await page.locator('.rate').click();
    await expect(page.locator('.rate')).toHaveText('1.25×');

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await page.waitForTimeout(100);

    const stored = await read_stored(page);
    expect(stored).not.toBeNull();
    expect(stored!.rate).toBe(1.25);
    expect(stored!.position).toBeGreaterThan(7);
    expect(stored!.position).toBeLessThan(8);
  });

  // Q: When the route mounts and storage already has a stored state, does it
  //    read that state and apply the persisted rate to the UI?
  test('mount reads stored state from localStorage and applies it', async ({ page }) => {
    await write_stored(page, { position: 12.3, rate: 1.5 });
    await page.reload();
    await page.waitForSelector('.rate');
    await expect(page.locator('.rate')).toHaveText('1.5×');
  });

  // Q: After leaving / and hitting back, is the persisted state still there?
  //    Either bfcache restored the live page (currentTime kept in memory) or a
  //    fresh mount reads storage — either way the user's position must not
  //    vanish.
  test('bfcache round trip — back navigation preserves stored state', async ({ page }) => {
    await page.evaluate(() => {
      const a = document.querySelector('audio') as HTMLAudioElement;
      a.currentTime = 4.2;
    });
    await page.locator('.rate').click();
    await page.locator('.rate').click();
    await expect(page.locator('.rate')).toHaveText('1.5×');

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await page.waitForTimeout(100);

    await page.goto('about:blank');
    await page.goBack();
    await page.waitForSelector('.rate');

    const stored = await read_stored(page);
    expect(stored).not.toBeNull();
    expect(stored!.rate).toBe(1.5);
    expect(stored!.position).toBeGreaterThan(3.5);
    expect(stored!.position).toBeLessThan(5);
    await expect(page.locator('.rate')).toHaveText('1.5×');
  });
});
