import type { ChildProcess } from 'node:child_process';
import { PEOPLE_ACROSS_GAMES } from '@adam0white/lab-kit';
import { type Browser, chromium } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startBrowserServer } from './browser-server.ts';

let server: ChildProcess, browser: Browser, origin: string;
beforeAll(async () => {
  ({ server, origin } = await startBrowserServer('hf-public'));
  browser = await chromium.launch();
}, 30000);
afterAll(async () => {
  server?.kill('SIGTERM');
  await browser?.close();
}, 30000);
it('opens the complete ordinary term and its public notebook on phone and desktop', async () => {
  for (const viewport of [
    { width: 360, height: 690 },
    { width: 1280, height: 800 },
  ]) {
    const context = await browser.newContext({ viewport, extraHTTPHeaders: { DNT: '1' } });
    const page = await context.newPage();
    try {
      await page.route('**/*', (route) => {
        const request = route.request();
        return request.method() === 'GET' && new URL(request.url()).origin === origin
          ? route.continue()
          : route.abort();
      });
      await page.goto(origin);
      await page.getByRole('button', { name: 'New game', exact: true }).click();
      await page.locator('#map').waitFor({ timeout: 30000 });
      // Pause the public menu before inspecting the actual running game.
      await page.locator('[data-pace-menu]').click();
      const state = await page.evaluate(`import('/src/ui/app.ts').then(({_debug})=>{
        const game=_debug.game();
        return {rules:game.valley.edition?.id,dialogue:!!game.valley.dialogue,pass:!!game.valley.pass,care:!!game.valley.stewardCare,overflow:document.documentElement.scrollWidth>innerWidth};
      })`);
      expect(state).toEqual({
        rules: 'valley-public-2026-10',
        dialogue: true,
        pass: true,
        care: true,
        overflow: false,
      });
      const menu = page.locator('.game-menu-panel');
      expect(await menu.locator('[data-notebook]').isVisible()).toBe(true);
      expect(await menu.getByRole('button', { name: 'Fast', exact: true }).isVisible()).toBe(true);
      expect(
        await menu.getByRole('link', { name: PEOPLE_ACROSS_GAMES, exact: true }).getAttribute('href'),
      ).toBe('https://human.adamwhite.work/lab/people/');
      const debug = menu.locator('.menu-debug');
      expect(await debug.getAttribute('open')).toBeNull();
      expect(await menu.getByRole('link', { name: 'Lab privacy', exact: true }).isVisible()).toBe(true);
    } finally {
      await context.close();
    }
  }
}, 120000);
