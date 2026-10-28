import type { ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { type Browser, chromium } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { act, newGame, save, step } from '../src/sim/game.ts';
import { startBrowserServer, visibleText } from './browser-server.ts';

let server: ChildProcess, browser: Browser, origin: string;
beforeAll(async () => {
  ({ server, origin } = await startBrowserServer('context-visit'));
  browser = await chromium.launch();
}, 30000);
afterAll(async () => {
  server?.kill('SIGTERM');
  await browser?.close();
}, 30000);
it.each([
  [360, 690],
  [1280, 800],
])('uses source-specific visit questions in the actual App %ix%i', async (width, height) => {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  const proof: unknown[] = [];
  try {
    await page.clock.install();
    await page.goto(`${origin}/file/`);
    await page.clock.pauseAt(Date.now() + 50);
    for (const [house, at, label] of [
      ['water-guest', 450, 'Danyal, you and Maryam'],
      ['tepe', 450, 'About your son'],
      ['coban', 6240, 'The birth notice says'],
    ] as const) {
      const g = newGame(7, undefined, false, true, 'valley-public-2026-10');
      step(g, at - 30);
      act(g, { verb: 'visit', house });
      step(g, at);
      await page.getByLabel('Open a Valley file').setInputFiles({
        name: 'context.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(save(g))),
      });
      await expect.poll(() => page.locator('#map').count(), { timeout: 30000 }).toBe(1);
      await page.locator(`[data-h="${house}"]`).click();
      const question = page.getByRole('button', { name: new RegExp(`^${label}`) });
      await question.click();
      const pending = await visibleText(page.locator('.context-visit'));
      expect(pending).toContain('No answer yet');
      expect(pending).toContain(house === 'coban' ? '20 July' : 'original date not recorded');
      await page.evaluate(`import('/src/ui/app.ts').then(({_debug})=>_debug.skipTo(${at + 90}/1440))`);
      const text = await visibleText(page.locator('.context-visit'));
      expect(text).not.toContain('Completed answer:');
      expect(text).toContain(
        house === 'water-guest' ? 'ended without a completed answer' : 'has not chosen to answer',
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const run = await page.evaluate(
        `Promise.all([import('/src/ui/app.ts'),import('/src/sim/game.ts')]).then(([{_debug},{save}])=>save(_debug.game()))`,
      );
      proof.push({ house, at, pending, text, run });
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByRole('button', { name: 'Open another Valley file', exact: true }).click();
    }
    expect(errors).toEqual([]);
    if (process.env.VALLEY_CONTEXT_PROOF_DIR)
      writeFileSync(
        `${process.env.VALLEY_CONTEXT_PROOF_DIR}/app-${width}.json`,
        JSON.stringify({ width, height, proof, errors, externalTrafficBlocked: true, screenshots: 0 }),
      );
  } finally {
    await page.close();
  }
});

it.each([
  [360, 690],
  [1280, 800],
])('renders the genuinely completed new Tepe answer in the actual App %ix%i', async (width, height) => {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  try {
    const g = newGame(7, undefined, false, true, 'valley-public-2026-10');
    act(g, {
      verb: 'call',
      job: 'reap-agha',
      houses: g.valley.households.filter((h) => h.hamlet === 'lower').map((h) => h.id),
    });
    step(g, 6300);
    act(g, { verb: 'visit', house: 'tepe' });
    step(g, 6330);
    await page.clock.install();
    await page.goto(`${origin}/file/`);
    await page.clock.pauseAt(Date.now() + 50);
    await page.getByLabel('Open a Valley file').setInputFiles({
      name: 'positive.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(save(g))),
    });
    await expect.poll(() => page.locator('#map').count(), { timeout: 30000 }).toBe(1);
    await page.getByRole('button', { name: 'Decline the invitation', exact: true }).click();
    await page.locator('[data-h="tepe"]').click();
    if (process.env.VALLEY_CONTEXT_PROOF_DIR)
      writeFileSync(
        `${process.env.VALLEY_CONTEXT_PROOF_DIR}/positive-before-${width}.json`,
        JSON.stringify({
          text: await visibleText(page.locator('body')),
          run: await page.evaluate(
            `import('/src/ui/app.ts').then(({_debug})=>({minute:_debug.game().valley.minute,visit:_debug.game().valley.kahyaState.visit,inputs:_debug.game().inputs,dialogue:_debug.game().valley.dialogue,person:_debug.game().valley.people.find(p=>p.id==='serife')}))`,
          ),
        }),
      );
    await page.getByRole('button', { name: /^About your son and the coffeehouse/ }).click();
    expect(await visibleText(page.locator('.context-visit'))).toContain('No answer yet');
    await page.evaluate(`import('/src/ui/app.ts').then(({_debug})=>_debug.skipTo(6390/1440))`);
    const text = await visibleText(page.locator('.context-visit'));
    expect(text).toContain('The talk finished.');
    expect(text).toContain('Completed answer: “I have not told you why he is there.');
    expect(text).toContain('This visit is not an agreement to send anyone.');
    expect(text).toContain('original date not recorded');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const actual = await page.evaluate(
      `Promise.all([import('/src/ui/app.ts'),import('/src/sim/game.ts')]).then(([{_debug},{save}])=>save(_debug.game()))`,
    );
    if (process.env.VALLEY_CONTEXT_PROOF_DIR)
      writeFileSync(
        `${process.env.VALLEY_CONTEXT_PROOF_DIR}/positive-app-${width}.json`,
        JSON.stringify({ width, height, text, actual, errors, externalTrafficBlocked: true, screenshots: 0 }),
      );
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});
