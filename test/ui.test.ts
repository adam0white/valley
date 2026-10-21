import type { ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { act, type Input, newGame, step } from '../src/sim/game.ts';
import { underSeal } from '../src/sim/valley.ts';
import { startBrowserServer } from './browser-server.ts';

const shots = process.env.CI
  ? '/tmp/valley-phone-tests'
  : '/Users/abdul/code/.lab-scratch/patterns/valley-shots/test';

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

async function selectHouseAction(page: Page, label: string) {
  const alternatives = page.getByRole('button', { name: 'Other house actions', exact: true });
  if (await alternatives.count()) await alternatives.click();
  await page.locator('#house-action').selectOption({ label });
}

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
    const info = page.getByRole('button', { name: 'Words used in the valley', exact: true });
    await info.focus();
    await page.keyboard.press('Space');
    expect(await glossary.evaluate((element) => element.matches(':popover-open'))).toBe(true);
    expect(await glossary.innerText()).toMatch(/kahya.*steward/s);
    expect(await glossary.innerText()).toMatch(/agha.*landowner/s);
    expect(await glossary.innerText()).toMatch(/kile.*grain measure/s);
    await page.keyboard.press('Escape');
    expect(await glossary.evaluate((element) => element.matches(':popover-open'))).toBe(false);
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
    expect(await page.locator('#sheet-head').innerText()).toContain('Kavak');
    await page.getByRole('button', { name: 'About', exact: true }).click();
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
      await selectHouseAction(page, 'Walk down and sit with them');
      await page.getByRole('button', { name: /Walk down and sit/ }).click();
      expect(await page.getByRole('button', { name: /You are out on the lanes/ }).isDisabled()).toBe(true);
      expect(await page.locator('#thumbs').innerText()).toMatch(/return/);
      await page.getByRole('button', { name: 'About', exact: true }).click();
      if (!(await page.locator('.pending-replies').evaluate((el) => (el as HTMLDetailsElement).open)))
        await page.locator('.pending-replies summary').click();
      await page.clock.runFor(700);
      expect(await page.locator('.pending-replies').evaluate((el) => (el as HTMLDetailsElement).open)).toBe(
        true,
      );
      await page.locator('#sheet-head').scrollIntoViewIfNeeded();
      mkdirSync(shots, { recursive: true });
      await page.screenshot({
        path: `${shots}/replies-${width}x${height}.png`,
        fullPage: true,
        animations: 'disabled',
      });
      await page.screenshot({
        path: `${shots}/replies-viewport-${width}x${height}.png`,
        animations: 'disabled',
      });
      // Returning is a simulation boundary; inspection now deliberately slows the live clock.
      await page.evaluate(`(async () => {
        const { _debug } = await import('/src/ui/app.ts');
        const { step } = await import('/src/sim/game.ts');
        const game = _debug.game();
        step(game, game.valley.kahyaState.visit.back + 30);
        _debug.skipTo(0);
      })()`);
      await page.clock.runFor(100);
      expect(await page.getByRole('button', { name: /Walk down and sit/ }).isEnabled()).toBe(true);
    } finally {
      await page.close();
    }
  },
);

it.each([
  [360, 690],
  [320, 690],
  [1280, 800],
])('keeps decision state, scene, Close and grain controls visible at %ix%i', async (width, height) => {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: true });
  try {
    await open(page);
    await page.locator('#houses button').first().click();
    const visible = async (selector: string) => {
      const box = await page.locator(selector).boundingBox();
      expect(box, selector).not.toBeNull();
      if (!box) throw new Error(selector);
      expect(box.y, selector).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, selector).toBeLessThanOrEqual(height + 1);
    };
    for (const selector of ['#now', '#next', '#cap', '#map', '.house-close', '#thumbs'])
      await visible(selector);
    expect(await page.locator('#map').evaluate((e) => e.clientHeight)).toBeGreaterThanOrEqual(44);
    const close = page.locator('.house-close');
    expect(
      await close.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }),
    ).toBe(true);
    await selectHouseAction(page, 'Send them grain');
    const grain = page.getByRole('button', { name: /Send them grain/ });
    await grain.click();
    expect(await page.locator('.house-response').innerText()).toMatch(
      /grain|jar|bread|gave|sack|hungry|enough/i,
    );
    for (const selector of ['#now', '#next', '#cap', '#map', '.house-close', '#thumbs', '.house-response'])
      await visible(selector);
    await page.getByRole('button', { name: 'Game menu', exact: true }).click();
    await page.keyboard.press('Escape');
    expect(await close.isVisible()).toBe(true);
    await page.getByRole('button', { name: 'About', exact: true }).click();
    await visible('#thumbs');
    expect(await page.locator('.house-about').evaluate((e) => e === document.activeElement)).toBe(true);
    await close.click();
    expect(
      await page
        .locator('#houses button')
        .first()
        .evaluate((e) => e === document.activeElement),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
    await selectHouseAction(page, 'Ease their share');
    const ease = page.getByRole('button', { name: /Ease their share/ });
    expect(await ease.isDisabled()).toBe(true);
    expect(await ease.innerText()).toMatch(/25 June, year two/);
    await selectHouseAction(page, 'Send them grain');
    const gift = page.getByRole('button', { name: /Send them grain/ });
    expect(await gift.isDisabled()).toBe(true);
    expect(await gift.innerText()).toMatch(/granary.*(low|empty)|grain.*arriv/i);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await page.locator('.ledger').isVisible()).toBe(true);
    await page.locator('#valley-action').selectOption({ label: 'Write to the landowner for grain' });
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
    await page.locator('#valley-action').selectOption({ label: 'Write to the landowner for grain' });
    const letter = page.getByRole('button', { name: /Write to the landowner/ });
    expect(await letter.isDisabled()).toBe(true);
    await page.clock.runFor(2400);
    expect(await letter.isEnabled()).toBe(true);
  } finally {
    await page.close();
  }
});

it('keeps grain selected when other house actions unlock', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page);
    await page.locator('#houses button').first().click();
    await selectHouseAction(page, 'Send them grain');
    await page.evaluate(`Promise.resolve(window.__valley).then((_debug) => {
      _debug.game().valley.flags.verbs.push('ease', 'seize');
      _debug.skipTo(0);
    })`);
    expect(await page.locator('#house-action').inputValue()).toBe('Send them grain');
    expect(await page.locator('#thumbs button').innerText()).toMatch(/^Send them grain/);
  } finally {
    await page.close();
  }
});

it.each([
  [3390, 360],
  [4650, 360],
  [3390, 320],
  [4650, 320],
])('fits the exact Çoban reply and refusal at minute %i on a %ix690 phone', async (minute, width) => {
  const page = await browser.newPage({ viewport: { width, height: 690 }, hasTouch: true });
  const inputs: Input[] = [
    {
      verb: 'call',
      job: 'reap-agha',
      houses: ['kavak', 'ak', 'coban', 'dere', 'kara', 'demirci', 'kuyucu', 'tepe'],
      at: 750,
    },
    { verb: 'visit', house: 'ak', at: 2520 },
    { verb: 'give', house: 'ak', kile: 6, at: 3000 },
    { verb: 'visit', house: 'coban', at: 3330 },
    ...(minute > 3840 ? [{ verb: 'give' as const, house: 'coban', kile: 6, at: 3840 }] : []),
  ];
  try {
    await open(page, minute, 905871269, inputs);
    await page.locator('#houses button[data-h="coban"]').click();
    await page.clock.runFor(150);
    for (const selector of [
      '.house-response',
      '.decision-reply',
      '.decision-reply .hold',
      '#next',
      '.house-close',
    ]) {
      const box = await page.locator(selector).boundingBox();
      expect(box, selector).not.toBeNull();
      expect(box && box.y >= 0 && box.y + box.height <= 691, selector).toBe(true);
    }
    if (minute === 3390) expect(await page.locator('.house-response').innerText()).toContain('Or are you?');
    expect(await page.locator('.house-response').innerText()).toMatch(/20 July, year one/);
    expect(await page.locator('.decision-reply').innerText()).toMatch(/own barley.*remember being pushed/s);
    expect(await page.locator('.house-response').evaluate((e) => e.scrollHeight <= e.clientHeight + 2)).toBe(
      true,
    );
    expect(await page.locator('#next').innerText()).toMatch(/cut.*standing.*20 July.*5 August/s);
    await page.getByText('Other house actions', { exact: true }).click();
    const alternativesBox = await page.locator('#thumbs').boundingBox();
    expect(alternativesBox && alternativesBox.y + alternativesBox.height <= 691).toBe(true);
    await page.getByRole('button', { name: 'Choose a house', exact: true }).click();
    await page.locator('#houses button[data-h="coban"]').click();
    const press = page.locator('.decision-reply .hold');
    await press.click();
    expect(await page.getByRole('status').innerText()).toMatch(/hold/i);
    expect(await page.evaluate('window.__valley.game().inputs.filter(i=>i.verb === "insist").length')).toBe(
      0,
    );
    await press.focus();
    await page.keyboard.down('Enter');
    await page.clock.runFor(700);
    await page.keyboard.up('Enter');
    expect(await page.evaluate('window.__valley.game().inputs.filter(i=>i.verb === "insist").length')).toBe(
      1,
    );
  } finally {
    await page.close();
  }
});

it('exposes Visit directly after harvest and keeps known food beside Give', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 }, hasTouch: true });
  try {
    await open(page);
    await page.evaluate(`Promise.resolve(window.__valley).then((_debug) => {
      const s = _debug.game().valley;
      s.agha.standing = 0;
      s.flags.verbs.push('visit');
      s.kahyaState.guess = { ...s.kahyaState.guess, coban: {at: 0, bread: 12} };
      _debug.skipTo(0);
    })`);
    await page.locator('#houses button[data-h="coban"]').click();
    expect(await page.locator('#thumbs button').first().innerText()).toMatch(/Walk down and sit/);
    await selectHouseAction(page, 'Send them grain');
    expect(await page.locator('#thumbs').innerText()).toMatch(/scraping the jar/);
    await page.getByRole('button', { name: /Send them grain/ }).click();
    await page.evaluate(`Promise.resolve(window.__valley).then((_debug) => {
      _debug.game().valley.minute += 1440;
      _debug.skipTo(0);
    })`);
    expect(await page.locator('.house-response').innerText()).toMatch(/Earlier word.*18 July/s);
  } finally {
    await page.close();
  }
});

it.each([false, true])(
  'gives each phone house a distinct labelled 44px target (upper hamlet: %s)',
  async (upper) => {
    const page = await browser.newPage({ viewport: { width: 360, height: 690 }, hasTouch: true });
    try {
      await open(page);
      if (upper)
        await page.evaluate('window.__valley.game().valley.flags.upper = true; window.__valley.skipTo(0)');
      const boxes = await page.locator('#houses button[data-h]').evaluateAll((es) =>
        es.map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height, text: e.textContent };
        }),
      );
      expect(boxes.length).toBe(upper ? 14 : 8);
      for (const b of boxes) {
        expect(b.w).toBeGreaterThanOrEqual(44);
        expect(b.h).toBeGreaterThanOrEqual(44);
        expect(b.x >= 0 && b.x + b.w <= 360 && b.y + b.h <= 690, b.text ?? '').toBe(true);
      }
      expect(await page.locator('#houses').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
      const navBox = await page.locator('#houses').boundingBox();
      const sheetBox = await page.locator('.lk-sheet').boundingBox();
      expect(navBox && sheetBox && navBox.y + navBox.height <= sheetBox.y + 1).toBe(true);
    } finally {
      await page.close();
    }
  },
);

it('holds menu and notebook time without inputs and resumes automatic pacing', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  const state = () =>
    page.evaluate<{ minute: number; inputs: string }>(
      `import('/src/ui/app.ts').then(({ _debug }) => ({ minute: _debug.game().valley.minute, inputs: JSON.stringify(_debug.game().inputs) }))`,
    );
  try {
    await open(page);
    expect(await page.locator('[data-s]').count()).toBe(0);
    await page.getByRole('button', { name: 'Until something happens', exact: true }).click();
    await page.getByRole('button', { name: 'Game menu', exact: true }).click();
    const before = await state();
    await page.clock.runFor(2000);
    expect(await state()).toEqual(before);
    await page.getByRole('button', { name: 'Close menu', exact: true }).click();
    await page.clock.runFor(16000);
    const resumed = await state();
    expect(resumed.minute).toBeGreaterThan(before.minute);
    expect(resumed.inputs).toBe(before.inputs);
    await page.getByRole('button', { name: 'Game menu', exact: true }).click();
    await page.getByRole('button', { name: 'Send this run to the notebook', exact: true }).click();
    const sending = await state();
    await page.clock.runFor(2000);
    expect(await state()).toEqual(sending);
    await page.getByRole('button', { name: 'Not now', exact: true }).click();
    await page.clock.runFor(1500);
    expect((await state()).minute).toBeGreaterThan(sending.minute);
  } finally {
    await page.close();
  }
});

it('offers the closing grain tally only at the ending, closed until requested', async () => {
  const page = await browser.newPage();
  try {
    await open(page);
    await page.getByText('Game menu', { exact: true }).click();
    expect(await page.locator('[data-tally]').count()).toBe(0);
    expect(await page.locator('[data-closing-grain]').count()).toBe(0);
    await page.getByRole('button', { name: 'Close menu', exact: true }).click();
    await page.evaluate(`window.__valley.game().valley.flags.ended = 'dismissed'`);
    await page.clock.runFor(100);
    const tally = page.locator('[data-closing-grain]');
    await expect.poll(() => tally.textContent()).toContain('kile total');
    expect(await tally.isVisible()).toBe(false);
    await page.getByText('See the tally', { exact: true }).click();
    expect(await tally.isVisible()).toBe(true);
    await page.getByText('See the tally', { exact: true }).click();
    expect(await tally.isVisible()).toBe(false);
  } finally {
    await page.close();
  }
});
