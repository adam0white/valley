import type { ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { act, type Input, newGame, step } from '../src/sim/game.ts';
import { underSeal } from '../src/sim/valley.ts';
import { startBrowserServer } from './browser-server.ts';

let server: ChildProcess;
let browser: Browser;
let origin: string;
beforeAll(async () => {
  ({ server, origin } = await startBrowserServer('ui-test'));
  browser = await chromium.launch();
}, 30000);
afterAll(async () => {
  // ChildProcess.kill addresses only this exact process PID.
  server?.kill('SIGTERM');
  await browser?.close();
}, 30000);

async function open(page: Page, minute = 360, seed = 406153184, inputs: Input[] = []) {
  await page.clock.install();
  await page.goto(origin);
  await page.clock.pauseAt(Date.now() + 500);
  await page.evaluate(
    ({ minute, seed, inputs }) =>
      localStorage.setItem(
        'valley-log-v1',
        JSON.stringify({ game: 'valley', version: '0.1.0', seed, inputs, minute, volume: 0 }),
      ),
    { minute, seed, inputs },
  );
  await page.reload();
  await page.getByRole('button', { name: 'Open the ledger', exact: true }).click();
  for (let i = 0; i < 100 && !(await page.locator('#map').count()); i++) await page.clock.runFor(50);
  await page.clock.runFor(50);
}

it('keeps run controls in a reachable Game menu and explains office terms on request', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page);
    const menu = page.getByText('Game menu', { exact: true });
    expect(await menu.isVisible()).toBe(true);
    await menu.click();
    expect(await page.getByRole('button', { name: 'Download this run', exact: true }).isVisible()).toBe(true);
    expect(
      await page.getByRole('button', { name: 'Send this run to the notebook', exact: true }).isVisible(),
    ).toBe(true);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download this run', exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/^the-valley-.*\.json$/);
    await page.getByRole('button', { name: 'Your charge', exact: true }).click();
    const glossary = page.locator('.office-terms');
    await glossary.locator('summary').click();
    expect(await glossary.innerText()).toMatch(/kahya.*steward/s);
    expect(await glossary.innerText()).toMatch(/agha.*landowner/s);
    expect(await glossary.innerText()).toMatch(/kile.*grain measure/s);
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const box = await menu.boundingBox();
    expect(box && box.y >= 0 && box.y + box.height <= 690).toBe(true);
  } finally {
    await page.close();
  }
});

it('cannot bind a finished ledger after closing it', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page);
    await page.evaluate(`import('/src/ui/app.ts').then(({ _debug }) => _debug.skipTo(1200))`);
    await page.clock.runFor(100);
    await page.getByRole('button', { name: 'Close the ledger', exact: true }).click();
    await page.getByText('Game menu', { exact: true }).click();
    expect(await page.getByRole('button', { name: 'Bind this volume now', exact: true }).isDisabled()).toBe(
      true,
    );
    expect(await page.evaluate(() => localStorage.getItem('valley-log-v1'))).toBeNull();
  } finally {
    await page.close();
  }
});

it.each([
  [360, 780],
  [412, 891],
  [1440, 900],
])('explains the current task and exposes house controls at %ix%i', async (width, height) => {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await open(page);
    expect(await page.locator('#now').innerText()).toMatch(/barley|harvest|rain/i);
    expect(await page.locator('#next').innerText()).toMatch(/August/);
    const house = page.locator('#houses button').first();
    expect(await house.isVisible()).toBe(true);
    await house.click();
    expect(await page.locator('.card').innerText()).toContain('Kavak');
    expect(await page.locator('.limits').innerText()).toMatch(/visit|walk|return|request/i);
    expect(await page.locator('.thumbs').innerText()).not.toMatch(/agha|kahya|kile/);
    await page.getByRole('button', { name: 'Your charge', exact: true }).click();
    expect(await page.locator('#sheet').innerText()).toMatch(/steward|landowner/);
    expect(await page.locator('#sheet').innerText()).toMatch(/elders/);
    const boxes = await page.locator('button:visible').evaluateAll((buttons) =>
      buttons.map((b) => {
        const r = b.getBoundingClientRect();
        return { text: b.textContent, width: r.width, height: r.height };
      }),
    );
    expect(boxes.filter((b) => b.width < 44 || b.height < 44)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Back to the notebook', exact: true }).click();
    await page.getByRole('button', { name: /Call the hamlet to the landowner’s barley/ }).click();
    expect(await page.locator('.limits').innerText()).toMatch(/crier|request|call/);
    expect(await page.locator('#now').innerText()).toMatch(/answer|repl|crier|called/i);
  } finally {
    await page.close();
  }
});

it.each([
  [360, 780],
  [412, 891],
])(
  'keeps active replies reachable across midnight and history, and restores visits after returning at %ix%i',
  async (width, height) => {
    const game = newGame(7);
    step(game, 360);
    act(game, {
      verb: 'call',
      job: 'reap-agha',
      houses: game.valley.households.filter((h) => underSeal(game.valley, h)).map((h) => h.id),
    });
    step(game, 1800);
    const page = await browser.newPage({ viewport: { width, height } });
    try {
      await open(page, game.valley.minute, 7, game.inputs);
      const summary = page.locator('.pending-replies summary');
      expect(await summary.isVisible()).toBe(true);
      await summary.click();
      const press = page.locator('.pending-replies button').first();
      expect(await press.isVisible()).toBe(true);
      expect(await press.innerText()).toMatch(/Not now|barley|later|own/i);
      const before = await page.locator('.pending-replies button').count();
      await page.getByRole('button', { name: 'Read more notes', exact: true }).click();
      expect(await page.locator('button.hold').count()).toBe(before);
      expect(await page.locator('.pending-replies button').first().isVisible()).toBe(true);
      await page.locator('#houses button').first().click();
      await page.getByRole('button', { name: /Walk down and sit/ }).click();
      expect(await page.getByRole('button', { name: /You are out on the lanes/ }).isDisabled()).toBe(true);
      expect(await page.locator('.limits').innerText()).toMatch(/return/);
      if (!(await page.locator('.pending-replies').evaluate((el) => (el as HTMLDetailsElement).open)))
        await page.locator('.pending-replies summary').click();
      await page.clock.runFor(700);
      expect(await page.locator('.pending-replies').evaluate((el) => (el as HTMLDetailsElement).open)).toBe(
        true,
      );
      await page.locator('.card .head').scrollIntoViewIfNeeded();
      mkdirSync('scratch/follow-up-ui', { recursive: true });
      await page.screenshot({
        path: `scratch/follow-up-ui/replies-${width}x${height}.png`,
        fullPage: true,
        animations: 'disabled',
      });
      await page.screenshot({
        path: `scratch/follow-up-ui/replies-viewport-${width}x${height}.png`,
        animations: 'disabled',
      });
      await page.clock.runFor(12000);
      expect(await page.getByRole('button', { name: /Walk down and sit/ }).isEnabled()).toBe(true);
    } finally {
      await page.close();
    }
  },
);

it.each([
  [360, 780],
  [412, 891],
])('keeps mobile date, household, replies and actions in document flow at %ix%i', async (width, height) => {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await open(page);
    const layout = await page.evaluate(() => {
      const element = (id: string) => {
        const el = document.querySelector(id);
        if (!el) throw new Error(`Missing ${id}`);
        return el;
      };
      const rect = (id: string) => element(id).getBoundingClientRect();
      return {
        dateBottom: rect('#cap').bottom,
        housesTop: rect('#houses').top,
        sheetOverflow: getComputedStyle(element('#sheet')).overflowY,
        actionsOverflow: getComputedStyle(element('#thumbs')).overflowY,
      };
    });
    expect(layout.dateBottom).toBeLessThanOrEqual(layout.housesTop);
    expect(layout.sheetOverflow).toBe('visible');
    expect(layout.actionsOverflow).toBe('visible');
    await page.locator('#houses button').first().click();
    await page.locator('.card .head').scrollIntoViewIfNeeded();
    const nameY = await page.locator('.card .head').evaluate((e) => e.getBoundingClientRect().top);
    await page.mouse.wheel(0, 120);
    await page.clock.runFor(100);
    const nextNameY = await page.locator('.card .head').evaluate((e) => e.getBoundingClientRect().top);
    expect(nextNameY).toBeLessThanOrEqual(nameY);
    expect(await page.locator('#sheet').evaluate((e) => e.scrollTop)).toBe(0);
    mkdirSync('scratch/follow-up-ui', { recursive: true });
    await page.clock.runFor(700);
    await page.locator('.card .head').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `scratch/follow-up-ui/house-${width}x${height}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await page.screenshot({
      path: `scratch/follow-up-ui/house-viewport-${width}x${height}.png`,
      animations: 'disabled',
    });
  } finally {
    await page.close();
  }
});

it('retains quiet unavailable actions with dated renewal and names the return destination', async () => {
  const page = await browser.newPage({ viewport: { width: 412, height: 891 } });
  try {
    await open(page);
    await page.evaluate(`(async () => {
      const { _debug } = await import('/src/ui/app.ts');
      const s = _debug.game().valley;
      s.flags.verbs.push('visit', 'take', 'ease', 'seize', 'give', 'borrow');
      s.agha.granary = 0;
      s.agha.loan = { kile: 80, owe: 100, asked: 0, arrives: 17280 };
      s.households[0].paid = 999;
      s.households[0].eased = true;
      _debug.skipTo(0);
    })()`);
    await page.getByRole('button', { name: 'The landowner’s ledger', exact: true }).click();
    await page.locator('#houses button').first().click();
    const ease = page.getByRole('button', { name: /Ease their share/ });
    expect(await ease.isDisabled()).toBe(true);
    expect(await ease.innerText()).toMatch(/25 June, year two/);
    const gift = page.getByRole('button', { name: /Send them grain/ });
    expect(await gift.isDisabled()).toBe(true);
    expect(await gift.innerText()).toMatch(/granary.*(low|empty)|grain.*arriv/i);
    await page.getByRole('button', { name: /Back to the landowner’s ledger/ }).click();
    expect(await page.locator('.ledger').isVisible()).toBe(true);
    expect(await page.getByRole('button', { name: /Write to the landowner/ }).isDisabled()).toBe(true);
    expect(await page.getByRole('button', { name: /Pause and return to the cover/ }).isVisible()).toBe(true);
    await page.getByRole('button', { name: /Pause and return to the cover/ }).click();
    await page.getByRole('button', { name: 'Open the ledger', exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Open the ledger', exact: true }).isVisible()).toBe(true);
  } finally {
    await page.close();
  }
});

it('labels holding on Press and explains a short click without submitting it', async () => {
  const game = newGame(7);
  step(game, 360);
  act(game, {
    verb: 'call',
    job: 'reap-agha',
    houses: game.valley.households.filter((h) => underSeal(game.valley, h)).map((h) => h.id),
  });
  step(game, 1800);
  const page = await browser.newPage({ viewport: { width: 360, height: 780 } });
  try {
    await open(page, game.valley.minute, 7, game.inputs);
    await page.locator('.pending-replies summary').click();
    const press = page.locator('.pending-replies button').first();
    expect(await press.innerText()).toMatch(/hold/i);
    await press.click();
    expect(await page.getByRole('status').innerText()).toMatch(/hold.*(press|insist)/i);
    const inputs = (await page.evaluate(
      `import('/src/ui/app.ts').then(m => m._debug.game().inputs)`,
    )) as Input[];
    expect(inputs.some((i) => i.verb === 'insist')).toBe(false);
    await press.focus();
    await page.keyboard.down('Enter');
    await page.clock.runFor(700);
    await page.keyboard.up('Enter');
    const after = (await page.evaluate(
      `import('/src/ui/app.ts').then(m => m._debug.game().inputs)`,
    )) as Input[];
    expect(after.filter((i) => i.verb === 'insist')).toHaveLength(1);
  } finally {
    await page.close();
  }
});

it('restores a loan letter at its return time without waiting for the next day', async () => {
  const page = await browser.newPage({ viewport: { width: 412, height: 891 } });
  try {
    await open(page);
    await page.evaluate(`(async () => {
      const { _debug } = await import('/src/ui/app.ts');
      const s = _debug.game().valley;
      s.flags.verbs.push('borrow');
      s.agha.loan = { kile: 80, owe: 100, asked: s.minute - 300 * 1440 + 30, arrives: 0 };
      _debug.skipTo(0);
    })()`);
    const letter = page.getByRole('button', { name: /Write to the landowner/ });
    expect(await letter.isDisabled()).toBe(true);
    await page.clock.runFor(2400);
    expect(await letter.isEnabled()).toBe(true);
  } finally {
    await page.close();
  }
});
