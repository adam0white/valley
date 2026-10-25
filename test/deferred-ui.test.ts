import type { ChildProcess } from 'node:child_process';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startBrowserServer } from './browser-server.ts';

let server: ChildProcess;
let browser: Browser;
let origin: string;
beforeAll(async () => {
  ({ server, origin } = await startBrowserServer('deferred-ui'));
  browser = await chromium.launch();
});
afterAll(async () => {
  server?.kill('SIGTERM');
  await browser?.close();
});
async function open(page: Page, rules?: string) {
  page.setDefaultTimeout(2000);
  await page.clock.install();
  await page.goto(origin);
  await page.clock.pauseAt(Date.now() + 500);
  await page.evaluate(
    (rules) =>
      localStorage.setItem(
        'valley-log-v1',
        JSON.stringify({
          game: 'valley',
          version: '0.3.0',
          seed: 7,
          minute: rules ? 1440 : 420,
          inputs: [],
          volume: 0,
          plainEnglish: true,
          ...(rules ? { rules } : {}),
        }),
      ),
    rules,
  );
  await page.reload();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  for (let i = 0; i < 100 && !(await page.locator('#map').count()); i++) await page.clock.runFor(50);
}
it('retains a household control focus through a timed sheet redraw', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page);
    await page.locator('[data-h="coban"]').click();
    await page.locator('.house-about').focus();
    await page.evaluate(`import('/src/ui/app.ts').then(({_debug})=>_debug.skipTo(0))`);
    expect(await page.locator('.house-about').evaluate((e) => e === document.activeElement)).toBe(true);
  } finally {
    await page.close();
  }
});
it('does not offer Resume or discard bytes when the stored log is malformed', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(origin);
    const raw = '{"game":"valley","inputs":[],"minute":1e30}';
    await page.evaluate((raw) => localStorage.setItem('valley-log-v1', raw), raw);
    await page.reload();
    expect(await page.getByRole('button', { name: 'Resume', exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('valley-log-v1'))).toBe(raw);
    await page.getByRole('button', { name: 'New game', exact: true }).click();
    expect(await page.locator('[data-confirm-title]').count()).toBe(1);
  } finally {
    await page.close();
  }
});
it('offers new-edition actions and preserves a readable reply at 320px with enlarged text', async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 690 } });
  try {
    await open(page, 'valley-2026-10');
    await page.locator('[data-h="coban"]').click();
    expect(await page.getByRole('button', { name: 'Ask for an extra sack', exact: true }).count()).toBe(1);
    await page.evaluate(() => (document.documentElement.style.fontSize = '34px'));
    await page.clock.runFor(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    expect(overflow).toBe(false);
    const visit = page.getByRole('button', { name: 'Visit', exact: true });
    await visit.scrollIntoViewIfNeeded();
    expect(await visit.isVisible()).toBe(true);
    for (const colorScheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.clock.runFor(50);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await visit.scrollIntoViewIfNeeded();
      expect(await visit.isVisible()).toBe(true);
    }
  } finally {
    await page.close();
  }
});
it('reports a failed binding honestly and retains the input log; prior volumes never rewind', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.clock.runFor(500);
    await expect.poll(() => page.locator('[data-save-status]').textContent()).toContain('were saved');
    await page.locator('[data-close-menu]').click();
    await page.locator('.grain-bar').click();
    await page.getByRole('button', { name: 'Read prior volumes', exact: true }).click();
    await page.clock.runFor(100);
    const volumes = page.getByRole('dialog', { name: 'Prior ledger volumes' });
    await expect.poll(() => volumes.textContent()).toContain('recorded actions');
    await volumes.locator('summary').first().click();
    await volumes.getByRole('button', { name: 'Read saved pages' }).first().click();
    await expect.poll(() => volumes.textContent()).toContain('landowner');
    await volumes.getByRole('button', { name: 'Close', exact: true }).click();
    await page.evaluate(() => {
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        value: {
          open() {
            throw new Error('blocked');
          },
        },
      });
    });
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.clock.runFor(100);
    await expect.poll(() => page.locator('[data-save-status]').textContent()).toContain('could not confirm');
    expect(await page.evaluate(() => localStorage.getItem('valley-log-v1'))).toContain('"seed":7');
  } finally {
    await page.close();
  }
});
it('keeps music off until chosen and renders a finite procedural cue', async () => {
  const page = await browser.newPage();
  try {
    await open(page);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    expect(await page.locator('[data-music]').getAttribute('aria-pressed')).toBe('false');
    const sound = await page.evaluate<{ peak: number; tail: number }>(`(async () => {
      const { cue } = await import('/src/ui/music.ts');
      const context = new OfflineAudioContext(1, 132300, 44100);
      cue(context, false, 0);
      const buffer = await context.startRendering();
      const samples = buffer.getChannelData(0);
      return { peak: Math.max(...samples.slice(0, 44100)), tail: Math.max(...samples.slice(-1000)) };
    })()`);
    expect(sound.peak).toBeGreaterThan(0.01);
    expect(sound.tail).toBe(0);
    await page.locator('[data-music]').click();
    await expect.poll(() => page.locator('[data-music]').getAttribute('aria-pressed')).toBe('true');
    await page.locator('[data-music]').click();
    await expect.poll(() => page.locator('[data-music]').getAttribute('aria-pressed')).toBe('false');
  } finally {
    await page.close();
  }
});
it('falls back to the exact input log when a recovery snapshot is corrupted', async () => {
  const page = await browser.newPage();
  try {
    await open(page, 'valley-2026-10');
    await page.evaluate(
      `import('/src/ui/app.ts').then(({_debug})=>_debug.order({verb:'term-choice',id:'reserve',choice:'hide'}))`,
    );
    const before = await page.evaluate(
      `import('/src/ui/app.ts').then(async({_debug})=>(await import('/src/sim/game.ts')).fingerprint(_debug.game().valley))`,
    );
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect.poll(() => page.locator('[data-save-status]').textContent()).toContain('were saved');
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open('valley', 1);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('volumes', 'readwrite');
        const store = tx.objectStore('volumes');
        const r = store.get('current');
        r.onsuccess = () => store.put({ ...r.result, gz: new Blob(['corrupt']) }, 'current');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    });
    await page.reload();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    for (let i = 0; i < 100 && !(await page.locator('#map').count()); i++) await page.clock.runFor(50);
    const after = await page.evaluate(
      `import('/src/ui/app.ts').then(async({_debug})=>(await import('/src/sim/game.ts')).fingerprint(_debug.game().valley))`,
    );
    expect(after).toBe(before);
  } finally {
    await page.close();
  }
});
it.each([undefined, 'valley-2026-10'] as const)(
  'resumes an actually accepted Unicode press without changing its ID (%s)',
  async (rules) => {
    const { newGame, act, step, fingerprint, DAY } = await import('../src/sim/game.ts');
    const game = newGame(7, undefined, false, true, rules);
    step(game, 347 * DAY + 8 * 60);
    expect(game.valley.flags.upper).toBe(true);
    expect(act(game, { verb: 'call', job: 'reap-agha', houses: ['topal'] })).toBe(true);
    step(game, 347 * DAY + 10 * 60);
    const ask = game.valley.asks.at(-1);
    if (!ask) throw new Error('The real upper-hamlet call is missing.');
    expect(ask.personIds).toContain('topal-rıza');
    expect(act(game, { verb: 'insist', ask: ask.id, pid: 'topal-rıza' })).toBe(true);
    const expected = fingerprint(game.valley);
    const log = {
      game: 'valley',
      version: '0.3.0',
      plainEnglish: true,
      seed: 7,
      minute: game.valley.minute,
      inputs: game.inputs,
      volume: 0,
      ...(rules ? { rules } : {}),
    };
    const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
    try {
      await page.clock.install();
      await page.goto(origin);
      await page.clock.pauseAt(Date.now() + 500);
      await page.evaluate((log) => localStorage.setItem('valley-log-v1', JSON.stringify(log)), log);
      await page.reload();
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
      for (let i = 0; i < 1000 && !(await page.locator('#map').count()); i++) await page.clock.runFor(50);
      expect(await page.locator('#map').count()).toBe(1);
      const actual = await page.evaluate(`import('/src/ui/app.ts').then(async({_debug})=>{
      const {fingerprint}=await import('/src/sim/game.ts');return {fingerprint:fingerprint(_debug.game().valley), last:_debug.game().inputs.at(-1)};
    })`);
      expect(actual).toEqual({
        fingerprint: expected,
        last: { verb: 'insist', ask: ask.id, pid: 'topal-rıza', at: game.valley.minute },
      });
      expect(await page.evaluate(() => localStorage.getItem('valley-log-v1'))).toContain('topal-rıza');
      step(game, 348 * DAY);
      await page.evaluate(`import('/src/ui/app.ts').then(({_debug}) => _debug.skipTo(348))`);
      const continued = await page.evaluate(
        `import('/src/ui/app.ts').then(async({_debug}) => (await import('/src/sim/game.ts')).fingerprint(_debug.game().valley))`,
      );
      expect(continued).toBe(fingerprint(game.valley));
    } finally {
      await page.close();
    }
  },
);
it.each([false, true])(
  'keeps the edition choice between title content and New game without overlap (lab=%s)',
  async (lab) => {
    const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
    try {
      await page.goto(origin + (lab ? '/?lab=1' : '/'));
      await page.evaluate(() => localStorage.setItem('valley-log-v1', '{"malformed":true}'));
      await page.reload();
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => {
        const edition = document.querySelector('.edition-choice')?.getBoundingClientRect();
        const tools = document.querySelector('[data-ways]')?.getBoundingClientRect();
        const start = document.querySelector('[data-go="new"]')?.getBoundingClientRect();
        if (!edition || !start) throw Error('Missing new-term choice');
        const text = document.createRange();
        const label = document.querySelector('.edition-choice');
        if (!label) throw Error('Missing edition label');
        text.selectNodeContents(label);
        const lines = [...text.getClientRects()];
        return {
          editionTop: edition.top,
          editionBottom: edition.bottom,
          toolsBottom: tools?.bottom ?? 0,
          startTop: start.top,
          startBottom: start.bottom,
          textFits: lines.every((r) => r.top >= edition.top - 1 && r.bottom <= edition.bottom + 1),
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });
      expect(geometry.editionTop).toBeGreaterThanOrEqual(geometry.toolsBottom);
      expect(geometry.textFits).toBe(true);
      expect(geometry.editionBottom).toBeLessThanOrEqual(geometry.startTop);
      expect(geometry.startBottom).toBeLessThanOrEqual(690);
      expect(geometry.overflow).toBe(false);
      await page.locator('.edition-choice').evaluate((e) => {
        (e as HTMLElement).style.fontSize = '34px';
      });
      const startButton = page.getByRole('button', { name: 'New game', exact: true });
      await startButton.scrollIntoViewIfNeeded();
      const enlarged = await startButton.boundingBox();
      expect(enlarged && enlarged.y >= 0 && enlarged.y + enlarged.height <= 690).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    } finally {
      await page.close();
    }
  },
);
