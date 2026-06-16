import type { Page } from '@playwright/test';

export async function block_external_audio(page: Page): Promise<void> {
  await page.route(/archive\.org\/.*\.mp3$/, (route) =>
    route.fulfill({ status: 204, body: '' }),
  );
}
