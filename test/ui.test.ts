import type { ChildProcess } from 'node:child_process';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { compactRun, type Input, newGame, save } from '../src/sim/game.ts';
import { startBrowserServer } from './browser-server.ts';

let server: ChildProcess;
let browser: Browser;
let origin: string;
beforeAll(async () => {
  ({ server, origin } = await startBrowserServer('ui-test'));
  browser = await chromium.launch();
}, 30000);
afterAll(async () => {
  server?.kill('SIGTERM');
  await browser?.close();
}, 30000);

async function open(page: Page, minute = 360, seed = 406153184, inputs: Input[] = []) {
  page.setDefaultTimeout(4000);
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
  for (let i = 0; i < 100 && !(await page.locator('#map').count()); i++) {
    await page.clock.runFor(50);
  }
  expect(await page.locator('#map').count()).toBe(1);
  await page.clock.runFor(50);
}
const state = (page: Page) =>
  page.evaluate<{ minute: number; inputs: string }>(
    `import('/src/ui/app.ts').then(({ _debug }) => ({ minute: _debug.game().valley.minute, inputs: JSON.stringify(_debug.game().inputs) }))`,
  );
async function fits(page: Page) {
  expect(
    await page.evaluate(() => ({
      height: (document.scrollingElement?.scrollHeight ?? Infinity) <= innerHeight + 1,
      width: (document.scrollingElement?.scrollWidth ?? Infinity) <= innerWidth,
    })),
  ).toEqual({ height: true, width: true });
}

it.each([
  [360, 690],
  [1280, 800],
])('keeps the map, one house row and bottom actions in the %ix%i play frame', async (width, height) => {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await open(page);
    await fits(page);
    expect(await page.locator('select').count()).toBe(0);
    expect(await page.locator('[data-s]').count()).toBe(0);
    const map = await page.locator('#map').boundingBox();
    expect(map).not.toBeNull();
    expect(map?.height).toBeGreaterThanOrEqual(190);
    const houses = await page.locator('#houses [data-h]').evaluateAll((es) =>
      es.map((e) => {
        const r = e.getBoundingClientRect();
        return { y: r.y, w: r.width, h: r.height };
      }),
    );
    expect(houses).toHaveLength(8);
    expect(new Set(houses.map((h) => Math.round(h.y))).size).toBe(1);
    expect(houses.every((h) => h.w >= 44 && h.h >= 44)).toBe(true);
    if (width === 360)
      expect(await page.locator('#houses').evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    else {
      const sheet = await page.locator('.lk-sheet').boundingBox();
      expect(sheet?.x).toBeGreaterThanOrEqual((map?.x ?? Infinity) + (map?.width ?? Infinity) - 1);
    }
    await page.evaluate(`import('/src/ui/app.ts').then(({ _debug }) => {
      _debug.game().valley.flags.upper = true; _debug.skipTo(0);
    })`);
    const expanded = await page
      .locator('#houses [data-h]')
      .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().top));
    expect(expanded.length).toBeGreaterThan(houses.length);
    expect(new Set(expanded.map(Math.round)).size).toBe(1);
    await page.locator('#houses [data-h="coban"]').click();
    expect((await page.locator('#map').boundingBox())?.height).toBeGreaterThanOrEqual(120);
    expect(await page.locator('#houses [data-h="coban"]').getAttribute('aria-pressed')).toBe('true');
    expect(await page.locator('.primary:visible').count()).toBe(0);
    await fits(page);
  } finally {
    await page.close();
  }
});

it('replaces a call with Skip and opens replies without a fold', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page, 360, 7);
    await page.getByRole('button', { name: /Call the hamlet.*barley/ }).click();
    expect(await page.getByRole('button', { name: 'Skip to the next event', exact: true }).isVisible()).toBe(
      true,
    );
    expect((await state(page)).inputs).toContain('"verb":"call"');
    await page.evaluate(`import('/src/ui/app.ts').then(({ _debug }) => _debug.skipTo(2))`);
    expect(await page.getByText('Replies to the call', { exact: false }).first().isVisible()).toBe(true);
    const replies = page.locator('.pending-replies');
    expect(await replies.locator('summary').count()).toBe(0);
    expect(await replies.innerText()).toMatch(/came|put off|refused/);
    expect(await page.locator('#houses').innerText()).toContain('●');
  } finally {
    await page.close();
  }
});

it('keeps the exact Çoban reply readable and requires a hold before insisting', async () => {
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
  ];
  const page = await browser.newPage({ viewport: { width: 360, height: 690 }, hasTouch: true });
  try {
    await open(page, 3390, 905871269, inputs);
    await page.locator('#houses [data-h="coban"]').click();
    const reply = page.locator('.house-response');
    expect(await reply.innerText()).toContain('Or are you?');
    expect(await reply.innerText()).toMatch(/20 July, year one/);
    expect(await reply.evaluate((e) => e.scrollHeight <= e.clientHeight + 2)).toBe(true);
    const press = page.locator('.decision-reply .hold');
    const box = await press.boundingBox();
    expect(box && box.y >= 0 && box.y + box.height <= 690).toBe(true);
    await press.click();
    expect(await page.locator('#hold-feedback').innerText()).toMatch(/hold/i);
    expect((await state(page)).inputs).not.toContain('"verb":"insist"');
    await press.focus();
    await page.keyboard.down('Enter');
    await page.clock.runFor(700);
    await page.keyboard.up('Enter');
    expect(JSON.parse((await state(page)).inputs).filter((i: Input) => i.verb === 'insist')).toHaveLength(1);
    await fits(page);
  } finally {
    await page.close();
  }
});

it('explains a blocked house verb without adding an input', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page);
    await page.evaluate(`import('/src/ui/app.ts').then(({ _debug }) => {
      const s = _debug.game().valley; s.flags.verbs.push('give', 'ease', 'seize');
      s.agha.granary = 0; _debug.skipTo(0);
    })`);
    await page.locator('#houses [data-h]').first().click();
    const before = (await state(page)).inputs;
    const give = page.getByRole('button', { name: 'Send grain', exact: true });
    expect(await give.getAttribute('aria-disabled')).toBe('true');
    // aria-disabled communicates the block; a real tap still explains its reason.
    await give.click({ force: true });
    expect(await page.locator('#thumbs').innerText()).toMatch(/granary.*(low|empty)|grain.*arriv/i);
    expect((await state(page)).inputs).toBe(before);
  } finally {
    await page.close();
  }
});

it('holds the clock for the menu and info, and slows the ledger for reading', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page);
    const menu = page.locator('[data-menu]');
    expect(await menu.evaluate((e) => !!e.closest('.lk-topbar, .topbar, .top-bar, header'))).toBe(true);
    await menu.click();
    const before = await state(page);
    await page.clock.runFor(3000);
    expect(await state(page)).toEqual(before);
    await page.keyboard.press('Escape');
    const info = page.locator('[data-info]');
    await info.click();
    const reading = await state(page);
    await page.clock.runFor(3000);
    expect(await state(page)).toEqual(reading);
    const popover = page.locator(':popover-open');
    expect(await popover.innerText()).toMatch(/kahya.*steward.*agha.*landowner.*kile.*grain measure/s);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /The ledger/ }).click();
    const ledgerStart = await state(page);
    await page.clock.runFor(3000);
    const ledgerEnd = await state(page);
    expect(ledgerEnd.minute - ledgerStart.minute).toBeLessThanOrEqual(6);
    expect(ledgerEnd.inputs).toBe(ledgerStart.inputs);
    await fits(page);
  } finally {
    await page.close();
  }
});

it('loads a compact playtest run through Other ways in and restores its fingerprint', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  const run = compactRun(save(newGame(7)));
  try {
    await page.goto(origin);
    await fits(page);
    await page.getByRole('button', { name: /Other ways in/ }).click();
    await page.getByLabel('Load a playtest run').setInputFiles({
      name: 'compact.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(run)),
    });
    await expect.poll(() => page.locator('body').innerText()).toMatch(/matches/i);
    expect(await page.locator('#map').isVisible()).toBe(true);
    expect(
      await page.evaluate(
        `import('/src/sim/game.ts').then(async ({fingerprint}) => fingerprint((await import('/src/ui/app.ts'))._debug.game().valley))`,
      ),
    ).toBe(run.fingerprint);
  } finally {
    await page.close();
  }
});

it('gives a knock the sheet and keeps the closing tally folded at the ending', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page);
    await page.evaluate(`import('/src/ui/app.ts').then(({ _debug }) => {
      const s = _debug.game().valley;
      s.knocks.push({ id: 'ui-knock', at: s.minute, until: s.minute + 1440,
        personId: s.households[0].members[0], house: s.households[0].id,
        what: 'grain', words: 'We have no grain left for tonight.' });
      _debug.skipTo(0);
    })`);
    const answers = page.locator('.knock button');
    expect(await answers.count()).toBe(2);
    for (const answer of await answers.all()) {
      const rect = await answer.boundingBox();
      expect(rect && rect.y >= 0 && rect.y + rect.height <= 690).toBe(true);
    }
    expect(await page.locator('#thumbs').isVisible()).toBe(false);
    expect(await page.getByRole('button', { name: 'Skip to the next event', exact: true }).count()).toBe(0);
    await fits(page);
    await page.evaluate(
      `import('/src/ui/app.ts').then(({ _debug }) => { _debug.game().valley.flags.ended = 'dismissed'; })`,
    );
    await page.clock.runFor(100);
    const tally = page.locator('[data-closing-grain]');
    expect(await tally.isVisible()).toBe(false);
    await page.getByText('See the tally', { exact: false }).click();
    expect(await tally.isVisible()).toBe(true);
    expect(await page.getByRole('button', { name: 'Send word', exact: true }).isVisible()).toBe(true);
    expect(await page.getByRole('button', { name: 'Download this run', exact: true }).isVisible()).toBe(true);
    expect(await page.getByRole('button', { name: 'Begin a new term', exact: true }).isVisible()).toBe(true);
    await fits(page);
  } finally {
    await page.close();
  }
});

it('excludes a future note from the same day in Earlier word', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page, 420);
    await page.evaluate(`import('/src/ui/app.ts').then(({ _debug }) => {
      const s = _debug.game().valley;
      s.notes.push({ id: 91001, at: 420, kind: 'story', text: 'UI present notebook note', weight: 1 });
      s.notes.push({ id: 91002, at: 600, kind: 'story', text: 'UI future notebook note', weight: 1 });
      _debug.skipTo(0);
    })`);
    await page.getByRole('button', { name: 'Earlier word ▸', exact: true }).click();
    const reader = page.locator('#sheet');
    expect(await reader.innerText()).toContain('UI present notebook note');
    expect(await reader.innerText()).not.toContain('UI future notebook note');
  } finally {
    await page.close();
  }
});

it('opens the completed notebook from the ending without restoring play', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page, 420);
    await page.evaluate(`import('/src/ui/app.ts').then(({ _debug }) => {
      const s = _debug.game().valley;
      s.notes.push({ id: 92001, at: s.minute, kind: 'story', text: 'UI completed notebook note', weight: 1 });
      s.flags.ended = 'dismissed';
    })`);
    await page.clock.runFor(100);
    await page.locator('[data-menu]').click();
    await page
      .locator('.game-menu-panel')
      .getByRole('button', { name: /The notebook/ })
      .click();
    const reader = page.locator('.notebook-panel');
    expect(await reader.count()).toBe(1);
    expect(await reader.isVisible()).toBe(true);
    expect(await reader.getByRole('heading', { name: 'Earlier word', exact: true }).isVisible()).toBe(true);
    expect(await reader.innerText()).toContain('UI completed notebook note');
    expect(await page.locator('.play').count()).toBe(0);
    const before = await state(page);
    await page.clock.runFor(3000);
    expect(await state(page)).toEqual(before);
    await page.keyboard.press('Escape');
    expect(await reader.isVisible()).toBe(false);
    expect(await page.getByRole('button', { name: 'Begin a new term', exact: true }).isVisible()).toBe(true);
    await fits(page);
  } finally {
    await page.close();
  }
});

it('keeps Other orders below the scene and house row', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page);
    await page.getByRole('button', { name: 'Other orders ▸', exact: true }).click();
    expect((await page.locator('.lk-sheet').boundingBox())?.y).toBeCloseTo(332, 0);
    expect(await page.locator('#thumbs').isVisible()).toBe(false);
  } finally {
    await page.close();
  }
});

it('opens the ledger directly below the state strip', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page);
    await page.getByRole('button', { name: 'The ledger ▸', exact: true }).click();
    expect((await page.locator('.lk-sheet').boundingBox())?.y).toBeCloseTo(80, 0);
    expect(await page.getByText('In the granary', { exact: true }).isVisible()).toBe(true);
  } finally {
    await page.close();
  }
});
