import type { ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { type Browser, chromium } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { act, load, newGame, save, stateJson, step } from '../src/sim/game.ts';
import { helpOf, helpTargets } from '../src/sim/terms.ts';
import { startBrowserServer, visibleText } from './browser-server.ts';
import { required } from './required.ts';

let server: ChildProcess, browser: Browser, origin: string;
beforeAll(async () => {
  ({ server, origin } = await startBrowserServer('received-terms'));
  browser = await chromium.launch();
}, 30000);
afterAll(async () => {
  server?.kill('SIGTERM');
  await browser?.close();
}, 30000);
it('offers and performs the public terms and keeps actual words in a stable phone/wide App with a native download', async () => {
  const proof: unknown[] = [];
  for (const [width, height] of [
    [360, 690],
    [1280, 800],
  ]) {
    const page = await browser.newPage({ viewport: { width: required(width), height: required(height) } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    try {
      let g = newGame(7, undefined, false, true, 'valley-public-2026-10');
      act(g, {
        verb: 'call',
        job: 'reap-agha',
        houses: ['tepe', 'coban', 'kavak', 'ak', 'dere', 'demirci', 'kuyucu', 'kara'],
      });
      act(g, { verb: 'visit', house: 'tepe' });
      step(g, 450);
      const target = required(helpTargets(g.valley).find((t) => t.person === 'recep'));
      const initialPacket = JSON.stringify(save(g));
      // Both reference and App admit the same actual JSON file. No Person/RNG normalization.
      g = load(JSON.parse(initialPacket));
      await page.clock.install();
      await page.goto(`${origin}/file/`);
      await page.clock.pauseAt(Date.now() + 50);
      await page.getByLabel('Open a Valley file').setInputFiles({
        name: 'terms.json',
        mimeType: 'application/json',
        buffer: Buffer.from(initialPacket),
      });
      await expect.poll(() => page.locator('#map').count(), { timeout: 30000 }).toBe(1);
      await page.locator('[data-h="tepe"]').click();
      await page
        .getByRole('button', { name: /^Offer these terms to/ })
        .first()
        .click();
      expect(act(g, target)).toBe(true);
      await page.locator('.grain-bar').click();
      expect(await visibleText(page.locator('.received-terms'))).toContain('No completed answer');
      await page.evaluate(`import('/src/ui/app.ts').then(({_debug})=>_debug.skipTo(2880/1440))`);
      step(g, 2880);
      expect(await visibleText(page.locator('.received-terms'))).toContain('Earned: 0.225 grain measures');
      // The gift is an ordinary public input; the UI keeps the actual named response, never a pool option.
      await page.evaluate(
        `import('/src/ui/app.ts').then(({_debug})=>_debug.order({verb:'give',house:'coban',kile:6}))`,
      );
      act(g, { verb: 'give', house: 'coban', kile: 6 });
      step(g, 2940);
      await page.evaluate(`import('/src/ui/app.ts').then(({_debug})=>_debug.skipTo(2940/1440))`);
      const source = required(
        g.valley.notes.findLast((n) => n.kind === 'voice' && n.house === 'coban' && n.at <= 2940),
      );
      // Open the complete reader through its public control; the source-specific button belongs to that note.
      await page.getByRole('button', { name: 'Back to the notebook', exact: true }).click();
      await page.getByRole('button', { name: 'Earlier replies ▸', exact: true }).click();
      const note = page
        .locator('.note')
        .filter({ hasText: source.text })
        .filter({ hasText: source.words ?? '' })
        .first();
      await note.locator('xpath=preceding-sibling::button[1]').click();
      expect(act(g, { verb: 'keep-words', note: source.id })).toBe(true);
      await page.locator('.grain-bar').click();
      expect(await visibleText(page.locator('.received-terms'))).toContain(source.words ?? '');
      await page.evaluate(`import('/src/ui/app.ts').then(({_debug})=>_debug.skipTo(4320/1440))`);
      step(g, 4320);
      while (await page.getByRole('button', { name: 'Decline the invitation', exact: true }).count()) {
        const k = required(
          g.valley.knocks.find((k) => !k.answered && k.at <= g.valley.minute && k.until > g.valley.minute),
        );
        await page.getByRole('button', { name: 'Decline the invitation', exact: true }).click();
        expect(act(g, { verb: 'turn-away', knock: k.id })).toBe(true);
      }
      await page.locator('.grain-bar').click();
      const beforeDispatch = save(g);
      await page.getByRole('button', { name: /^Carry the earned food to/ }).click();
      expect(act(g, { verb: 'help-deliver', contract: required(helpOf(g.valley)).id })).toBe(true);
      const returned = load(save(g));
      step(returned, 4710);
      expect(act(returned, { verb: 'help-return', contract: required(helpOf(returned.valley)).id })).toBe(
        true,
      );
      step(returned, 7200);
      await page.locator('[data-h="kara"]').click();
      expect(
        await page.getByRole('button', { name: 'Visit', exact: true }).getAttribute('aria-disabled'),
      ).toBe('true');
      await page.getByRole('button', { name: 'Back to the notebook', exact: true }).click();
      await page.getByRole('button', { name: 'Other orders ▸', exact: true }).click();
      expect(await page.getByRole('button', { name: /^Walk to Çam quarry/ }).isDisabled()).toBe(true);
      await page.evaluate(`import('/src/ui/app.ts').then(({_debug})=>_debug.skipTo(7200/1440))`);
      step(g, 7200);
      while (await page.getByRole('button', { name: 'Decline the invitation', exact: true }).count()) {
        const k = required(
          g.valley.knocks.find((k) => !k.answered && k.at <= g.valley.minute && k.until > g.valley.minute),
        );
        await page.getByRole('button', { name: 'Decline the invitation', exact: true }).click();
        expect(act(g, { verb: 'turn-away', knock: k.id })).toBe(true);
      }
      await page.locator('.grain-bar').click();
      const text = await visibleText(page.locator('.received-terms'));
      expect(text).toContain('Delivered: 0.225 grain measures');
      expect(text).toContain('Delivery: home');
      expect(text).toContain('before 23 July starts');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('#map').isVisible()).toBe(true);
      const actual = await page.evaluate(
        `Promise.all([import('/src/ui/app.ts'),import('/src/sim/game.ts')]).then(([{_debug},{save}])=>save(_debug.game()))`,
      );
      expect((actual as ReturnType<typeof save>).state).toEqual(stateJson(g.valley));
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download this Valley file', exact: true }).click();
      const downloaded = await downloadPromise;
      const path = required(await downloaded.path());
      const packet = JSON.parse(readFileSync(path, 'utf8'));
      expect(stateJson(load(packet).valley)).toEqual(stateJson(g.valley));
      await page.getByRole('button', { name: 'Open another Valley file', exact: true }).click();
      await page.getByLabel('Open a Valley file').setInputFiles({
        name: 'download.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(packet)),
      });
      await expect.poll(() => page.locator('#map').count(), { timeout: 30000 }).toBe(1);
      expect(errors).toEqual([]);
      const late = load(beforeDispatch);
      step(late, 7200);
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByRole('button', { name: 'Open another Valley file', exact: true }).click();
      await page.getByLabel('Open a Valley file').setInputFiles({
        name: 'late.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(save(late))),
      });
      await expect.poll(() => page.locator('#map').count(), { timeout: 30000 }).toBe(1);
      await page.locator('.grain-bar').click();
      const lateText = await visibleText(page.locator('.received-terms'));
      expect(lateText).toContain('The deadline passed. Earned grain is still owed.');
      expect(lateText).toContain('Delivered: 0 grain measures');
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByRole('button', { name: 'Open another Valley file', exact: true }).click();
      await page.getByLabel('Open a Valley file').setInputFiles({
        name: 'returned.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(save(returned))),
      });
      await expect.poll(() => page.locator('#map').count(), { timeout: 30000 }).toBe(1);
      await page.locator('.grain-bar').click();
      expect(await visibleText(page.locator('.received-terms'))).toContain('Held: 0.225 grain measures');
      expect(await page.getByRole('button', { name: /^Carry the earned food to/ }).count()).toBe(0);
      proof.push({
        width,
        height,
        lateText,
        text,
        actual,
        download: packet,
        errors,
        screenshots: 0,
        externalTrafficBlocked: true,
      });
    } finally {
      await page.close();
    }
  }
  if (process.env.VALLEY_TERMS_PROOF) writeFileSync(process.env.VALLEY_TERMS_PROOF, JSON.stringify(proof));
});
