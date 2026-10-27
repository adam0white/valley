import type { ChildProcess } from 'node:child_process';
import { type Browser, chromium } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startBrowserServer, visibleText } from './browser-server.ts';

let server: ChildProcess;
let browser: Browser;
let origin: string;
beforeAll(async () => {
  ({ server, origin } = await startBrowserServer('simplify'));
  browser = await chromium.launch();
}, 30000);
afterAll(async () => {
  server?.kill('SIGTERM');
  await browser?.close();
}, 30000);
it('makes gameplay public and keeps diagnostics collapsed beside privacy', async () => {
  const page = await browser.newPage();
  try {
    await page.route('https://human.adamwhite.work/**', (r) => r.fulfill({ status: 204, body: '' }));
    await page.goto(origin);
    expect(await page.locator('.edition-choice input').count()).toBe(0);
    expect(await page.locator('[data-continuity]').count()).toBe(0);
    await page.locator('[data-menu]').click();
    expect(await page.locator('[data-speed]').count()).toBe(4);
    const debug = page.locator('.menu-debug');
    expect(await debug.getAttribute('open')).toBeNull();
    expect(await debug.locator('[data-download]').isVisible()).toBe(false);
    await debug.locator('summary').click();
    await page.locator('[data-diagnostics]').click();
    expect(await page.locator('#valley-name').isVisible()).toBe(true);
    await page.locator('[data-ways-close]').click();
    await page.locator('[data-go="new"]').click();
    await expect.poll(() => page.locator('.play').count()).toBe(1);
    const rules = await page.evaluate(
      `import('/src/ui/app.ts').then(({_debug})=>_debug.game().valley.edition.id)`,
    );
    expect(rules).toBe('valley-public-2026-10');
  } finally {
    await page.close();
  }
});
it('keeps the previous saved run and receipts after failed admission, with a literal ordinary error', async () => {
  const page = await browser.newPage();
  try {
    await page.route('https://human.adamwhite.work/**', (r) => r.fulfill({ status: 204, body: '' }));
    await page.goto(origin);
    const previous = JSON.stringify({
      game: 'valley',
      version: '0.3.1',
      seed: 7,
      inputs: [],
      minute: 0,
      volume: 0,
      continuity: { runId: 'previous-receipt', heads: {}, sources: {} },
    });
    await page.evaluate((previous) => localStorage.setItem('valley-log-v1', previous), previous);
    await page.reload();
    // A rejected admission fixture exercises the ordinary rollback and error UI.
    await page.evaluate(`import('/src/ui/cast-session.ts').then(({CastSession}) => {
      CastSession.prototype.fresh = async () => { throw new Error('Shelf unavailable. Use a local file.'); };
    })`);
    await page.locator('[data-go="new"]').click();
    expect(await page.evaluate(() => localStorage.getItem('valley-log-v1'))).toBe(previous);
    await page.locator('[data-confirm-title]').click();
    await expect
      .poll(() => page.locator('[role="status"]').allTextContents())
      .toContain('The game could not start. Your saved game is kept. Try again or open Feedback.');
    expect(await page.evaluate(() => localStorage.getItem('valley-log-v1'))).toBe(previous);
    expect(await page.getByRole('button', { name: /without carrying/ }).count()).toBe(0);
    expect(await visibleText(page.locator('body'))).not.toContain('Shelf unavailable');
    await page.locator('[data-menu]').click();
    await page.locator('[data-feedback]').click();
    expect(await page.locator('[data-send]').isVisible()).toBe(true);
  } finally {
    await page.close();
  }
});

it('fits the visible SDK notice and keeps grain controls clear of the toolbar', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await page.route('https://human.adamwhite.work/**', (r) => r.fulfill({ status: 204, body: '' }));
    await page.goto(origin);
    await page.locator('.lk-telemetry-notice').waitFor({ state: 'visible' });
    const compact = await page.locator('.lk-telemetry-notice').evaluate((e) => {
      const range = document.createRange();
      range.selectNodeContents(e);
      const style = getComputedStyle(e);
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (context) context.font = `${style.fontSize} ${style.fontFamily}`;
      return {
        fontFamily: style.fontFamily,
        contentWidth: e.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        textWidth: context?.measureText(e.textContent ?? '').width,
        lineRects: [...range.getClientRects()].map((r) => ({
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
        })),
        text: e.textContent,
        font: parseFloat(getComputedStyle(e).fontSize),
        lines: range.getClientRects().length,
        node: e.getBoundingClientRect().height,
        wrapper: e.parentElement?.getBoundingClientRect().height,
      };
    });
    expect(compact.text).toBe('We record and link play across games on this device.');
    expect(compact.font).toBeGreaterThanOrEqual(14);
    expect(compact.lines, JSON.stringify(compact)).toBe(1);
    expect(compact.node).toBeLessThanOrEqual(40);
    expect(compact.wrapper).toBeLessThanOrEqual(40);
    expect(await page.getByRole('button', { name: 'Dismiss', exact: true }).count()).toBe(0);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '32px';
    });
    const enlarged = await page.locator('.lk-telemetry-notice').evaluate((e) => {
      const range = document.createRange();
      range.selectNodeContents(e);
      return {
        lines: range.getClientRects().length,
        font: parseFloat(getComputedStyle(e).fontSize),
        widthFits: e.scrollWidth <= e.clientWidth,
        heightFits: e.scrollHeight <= e.clientHeight + 1,
        bottom: e.getBoundingClientRect().bottom,
      };
    });
    expect(enlarged.lines).toBeGreaterThan(1);
    expect(enlarged.font).toBeGreaterThan(compact.font);
    expect(enlarged.widthFits && enlarged.heightFits).toBe(true);
    expect(enlarged.bottom).toBeLessThanOrEqual(691);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    for (const [width, height] of [
      [360, 690],
      [820, 1180],
      [1180, 820],
      [1280, 800],
    ] as const) {
      await page.setViewportSize({ width, height });
      const notice = await page.locator('.notice-footer').boundingBox();
      const app = await page.locator('#app').boundingBox();
      expect((notice?.y ?? Infinity) + (notice?.height ?? Infinity)).toBeLessThanOrEqual(height + 1);
      expect((app?.y ?? 0) + (app?.height ?? 0)).toBeLessThanOrEqual((notice?.y ?? 0) + 1);
    }
    await page.evaluate(`import('/src/sim/game.ts').then(({newGame,save}) => {
      const run=save(newGame(7));
      localStorage.setItem('valley-log-v1',JSON.stringify({game:'valley',version:run.version,plainEnglish:true,seed:7,inputs:[],minute:360,volume:0}));
    })`);
    await page.reload();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.locator('#map').waitFor();
    for (const [width, height] of [
      [820, 1180],
      [1180, 820],
      [1280, 800],
    ] as const) {
      await page.setViewportSize({ width, height });
      const grain = await page.locator('.grain-bar').boundingBox();
      const toolbar = await page.locator('.topbar-actions').boundingBox();
      expect((grain?.x ?? Infinity) + (grain?.width ?? Infinity)).toBeLessThanOrEqual(toolbar?.x ?? 0);
    }
  } finally {
    await page.close();
  }
});

it('opens public imports in a file session without replacing the native ledger or continuity receipt', async () => {
  const page = await browser.newPage();
  try {
    await page.route('https://human.adamwhite.work/**', (r) => r.fulfill({ status: 204, body: '' }));
    await page.goto(origin);
    const prior = await page.evaluate(`(async () => {
      const {newGame,compactRun}=await import('/src/sim/game.ts');
      const log=JSON.stringify({...compactRun(newGame(42)),volume:0,continuity:{runId:'native-kept',heads:{},sources:{}}});
      localStorage.setItem('valley-log-v1',log);
      return log;
    })()`);
    await page.reload();
    await page.locator('[data-menu]').click();
    await page.locator('.menu-debug summary').click();
    await page.getByRole('link', { name: 'Open a Valley file', exact: true }).click();
    const input = page.getByLabel('Open a Valley file', { exact: true });
    await input.waitFor();
    const file = await page.evaluate(
      `import('/src/sim/game.ts').then(({newGame,save})=>save(newGame(7,undefined,false,true,'valley-public-2026-10')))`,
    );
    await input.setInputFiles({
      name: 'public.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(file)),
    });
    await expect.poll(() => page.locator('.play').count()).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('valley-log-v1'))).toBe(prior);
    expect(await page.evaluate(`import('/src/ui/app.ts').then(({_debug})=>_debug.game().valley.seed)`)).toBe(
      7,
    );
  } finally {
    await page.close();
  }
});
