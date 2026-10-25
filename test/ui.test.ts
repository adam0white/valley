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

async function open(page: Page, minute = 360, seed = 406153184, inputs: Input[] = [], plainEnglish = true) {
  page.setDefaultTimeout(4000);
  await page.clock.install();
  await page.goto(origin);
  await page.clock.pauseAt(Date.now() + 500);
  await page.evaluate(
    ({ minute, seed, inputs, plainEnglish }) =>
      localStorage.setItem(
        'valley-log-v1',
        JSON.stringify({ game: 'valley', version: '0.3.0', seed, inputs, minute, volume: 0, plainEnglish }),
      ),
    { minute, seed, inputs, plainEnglish },
  );
  await page.reload();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
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
    expect(await page.locator('.play select').count()).toBe(0);
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
    expect(houses).toHaveLength(10);
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

it.each([
  [360, 690],
  [1280, 800],
])('keeps the selected-house instruction inside the scene at %ix%i', async (width, height) => {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await open(page);
    await page.locator('#houses [data-h="coban"]').click();
    const instruction = await page.locator('#now').evaluate((e) => {
      const map = e.parentElement!.getBoundingClientRect();
      const goal = e.getBoundingClientRect();
      const steward = document.querySelector('#steward')!.getBoundingClientRect();
      return { inside: goal.top >= map.top && goal.bottom <= steward.top };
    });
    expect(instruction.inside).toBe(true);
  } finally {
    await page.close();
  }
});

it('shows a visit conversation only when its scheduled time arrives', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page, 360, 7);
    await page.evaluate(
      `import('/src/ui/app.ts').then(({ _debug }) => _debug.order({ verb: 'visit', house: 'coban' }))`,
    );
    await page.clock.runFor(50);
    expect(await page.locator('#steward').innerText()).toMatch(/walking to/);
    expect(await page.locator('.house-response').count()).toBe(0);
    await page.locator('.house-about').click();
    expect(await page.locator('#sheet').innerText()).not.toContain('by the fire');
    // Keep the sheet open: it must redraw when the existing future note becomes due.
    await page.clock.runFor(35000);
    expect(await page.locator('.house-response').count()).toBe(1);
  } finally {
    await page.close();
  }
});

it('refreshes current word when a new note replaces one at the note cap', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page);
    await page.evaluate(`(async () => {
      const { _debug } = await import('/src/ui/app.ts');
      const { note } = await import('/src/sim/valley.ts');
      const s = _debug.game().valley;
      for (let i = 0; i < 400; i++) note(s, { at: s.minute, kind: 'voice', text: 'Old word', weight: 3 });
      _debug.skipTo(0);
    })()`);
    expect(await page.locator('.current-notes').innerText()).toContain('Old word');
    await page.evaluate(`(async () => {
      const { _debug } = await import('/src/ui/app.ts');
      const { note } = await import('/src/sim/valley.ts');
      const s = _debug.game().valley;
      note(s, { at: s.minute, kind: 'voice', text: 'A new word at the door', weight: 4 });
    })()`);
    await page.clock.runFor(1000);
    expect(await page.locator('.current-notes').innerText()).toContain('A new word at the door');
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
  const inputs: Input[] = [{ verb: 'call', job: 'reap-agha', houses: ['coban'], at: 750 }];
  const page = await browser.newPage({ viewport: { width: 360, height: 690 }, hasTouch: true });
  try {
    await open(page, 1020, 42, inputs);
    await page.locator('#houses [data-h="coban"]').click();
    const reply = page.locator('.decision-reply');
    expect(await reply.innerText()).toContain('own barley');
    expect(await reply.innerText()).toMatch(/18 July, year one/);
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
    expect(await page.locator('#thumbs').innerText()).toMatch(
      /granary.*(low|empty|too little)|grain.*arriv/i,
    );
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
    expect(await popover.innerText()).toMatch(/You are the steward.*landowner’s grain.*grain measures/s);
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

it('saves a recovery snapshot without a document-owned Blob input stream', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await open(page);
    await page.evaluate(
      `import('/src/ui/app.ts').then(({ _debug }) => _debug.order({ verb: 'visit', house: 'coban' }))`,
    );
    const latest = await state(page);
    await page.evaluate(() => {
      // Model the document-owned stream becoming unavailable during WebKit unload.
      Blob.prototype.stream = () => {
        throw new Error('Document Blob input is unavailable');
      };
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const readBound = () =>
      page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('valley', 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const bound = await new Promise<{ k: number; minute: number; gz: Blob } | undefined>(
            (resolve, reject) => {
              const request = database.transaction('volumes').objectStore('volumes').get('current');
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            },
          );
          if (!bound) return null;
          const bytes = await bound.gz.arrayBuffer();
          const text = await new Response(
            new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip')),
          ).text();
          return { k: bound.k, minute: bound.minute, state: JSON.parse(text) };
        } finally {
          database.close();
        }
      });
    await expect.poll(readBound).not.toBeNull();
    const bound = await readBound();
    expect(bound?.k).toBe(JSON.parse(latest.inputs).length);
    expect(bound?.minute).toBe(latest.minute);
    expect(bound?.state.minute).toBe(latest.minute);
    expect(bound?.state.households).toHaveLength(16);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it('keeps the prior recovery snapshot and latest input log when compression fails on hiding', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const snapshot = () =>
    page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('valley', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const bound = await new Promise<
          { runId: string; seed: number; k: number; minute: number; gz: Blob } | undefined
        >((resolve, reject) => {
          const request = database.transaction('volumes').objectStore('volumes').get('current');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return bound ? { ...bound, gz: Array.from(new Uint8Array(await bound.gz.arrayBuffer())) } : null;
      } finally {
        database.close();
      }
    });
  try {
    await open(page);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(snapshot).not.toBeNull();
    const prior = await snapshot();
    await page.evaluate(
      `import('/src/ui/app.ts').then(({ _debug }) => _debug.order({ verb: 'visit', house: 'coban' }))`,
    );
    const latest = await state(page);
    const receipt = await page.evaluate(() => JSON.parse(localStorage.getItem('valley-log-v1')!).continuity);
    await page.evaluate(() => {
      window.CompressionStream = class {
        constructor() {
          throw new Error('Simulated unloading compression failure');
        }
      } as unknown as typeof CompressionStream;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.runFor(50);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('valley-log-v1')!));
    expect(saved.minute).toBe(latest.minute);
    expect(JSON.stringify(saved.inputs)).toBe(latest.inputs);
    expect(saved.continuity).toEqual(receipt);
    expect(await snapshot()).toEqual(prior);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it.each(['other-chapter', undefined])(
  'ignores a same-seed bound volume without the current receipt (%s)',
  async (receipt) => {
    const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
    try {
      await open(page);
      const originalStore = await page.evaluate(`(async (receipt) => {
      const { _debug } = await import('/src/ui/app.ts');
      const { stateJson } = await import('/src/sim/game.ts');
      const g = _debug.game();
      const state = stateJson(g.valley);
      const original = state.households[0].store;
      state.households[0].store = 9999;
      const gz = await new Response(new Blob([JSON.stringify(state)]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('valley', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('volumes');
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      await new Promise((res, rej) => {
        const tx = db.transaction('volumes', 'readwrite');
        tx.objectStore('volumes').put({ seed: g.valley.seed, k: g.inputs.length, minute: g.valley.minute, runId: receipt, gz }, 'current');
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
      return original;
    })(${JSON.stringify(receipt)})`);
      await page.reload();
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
      for (let i = 0; i < 100 && !(await page.locator('#map').count()); i++) await page.clock.runFor(50);
      expect(
        await page.evaluate(
          `import('/src/ui/app.ts').then(({_debug}) => _debug.game().valley.households[0].store)`,
        ),
      ).toBe(originalStore);
    } finally {
      await page.close();
    }
  },
);

it('loads a compact playtest run through Other ways in and restores its fingerprint', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  const run = compactRun(save(newGame(7)));
  try {
    await page.goto(`${origin}/?lab=1`);
    await fits(page);
    await page.getByRole('button', { name: /Lab tools/ }).click();
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
    expect(await page.getByRole('button', { name: 'Feedback', exact: true }).isVisible()).toBe(true);
    expect(await page.getByRole('button', { name: 'Download this run', exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Begin a new term', exact: true }).isVisible()).toBe(true);
    await fits(page);
  } finally {
    await page.close();
  }
});

it('excludes a future note from the same day in Earlier replies', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page, 420);
    await page.evaluate(`import('/src/ui/app.ts').then(({ _debug }) => {
      const s = _debug.game().valley;
      s.notes.push({ id: 91001, at: 420, kind: 'story', text: 'UI present notebook note', weight: 1 });
      s.notes.push({ id: 91002, at: 600, kind: 'story', text: 'UI future notebook note', weight: 1 });
      _debug.skipTo(0);
    })`);
    await page.getByRole('button', { name: 'Earlier replies ▸', exact: true }).click();
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
    await page.getByRole('button', { name: 'Earlier replies', exact: true }).click();
    const reader = page.locator('.notebook-panel');
    expect(await reader.count()).toBe(1);
    expect(await reader.isVisible()).toBe(true);
    expect(await reader.getByRole('heading', { name: 'Earlier replies', exact: true }).isVisible()).toBe(
      true,
    );
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

it.each([
  [360, 690],
  [1280, 800],
])('keeps complete house guidance and scrollable About above actions at %ix%i', async (width, height) => {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await open(page);
    await page.getByRole('button', { name: 'the Ak house', exact: true }).click();
    await page.getByRole('button', { name: 'About ▾', exact: true }).click();
    // About first uses Literata italic. Measure and scroll after that font has settled.
    await page.evaluate(() => document.fonts.ready);
    const readable = async () =>
      page.evaluate(() => {
        const goal = document.querySelector<HTMLElement>('#now')!;
        const caption = document.querySelector<HTMLElement>('.action-caption')!;
        const body = document.querySelector<HTMLElement>('#sheet')!;
        const actions = document.querySelector<HTMLElement>('#thumbs')!;
        return {
          goal: goal.scrollWidth <= goal.clientWidth && goal.scrollHeight <= goal.clientHeight,
          caption:
            caption.scrollWidth <= caption.clientWidth + 1 &&
            caption.scrollHeight <= caption.clientHeight + 1,
          guidance: [...body.querySelectorAll<HTMLElement>('.limits')].every(
            (e) => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1,
          ),
          body:
            body.clientHeight >= 80 &&
            body.getBoundingClientRect().bottom <= actions.getBoundingClientRect().top + 1,
          actions: actions.getBoundingClientRect().bottom <= innerHeight + 1,
        };
      });
    expect(await readable()).toEqual({
      goal: true,
      caption: true,
      guidance: true,
      body: true,
      actions: true,
    });
    const body = page.locator('#sheet');
    await page.evaluate(() => document.fonts.ready);
    await body.evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    expect(await body.evaluate((e) => e.scrollTop + e.clientHeight >= e.scrollHeight - 1)).toBe(true);
    await page.getByRole('button', { name: 'Call to cut barley', exact: true }).click();
    await page.clock.runFor(30000);
    expect(
      await page.getByRole('button', { name: 'About ▾', exact: true }).getAttribute('aria-expanded'),
    ).toBe('true');
    await page.evaluate(() => document.fonts.ready);
    await body.evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    expect(await body.evaluate((e) => e.scrollTop + e.clientHeight >= e.scrollHeight - 1)).toBe(true);
    expect(await readable()).toEqual({
      goal: true,
      caption: true,
      guidance: true,
      body: true,
      actions: true,
    });
    await fits(page);
  } finally {
    await page.close();
  }
});

it('keeps a saved narration choice through local resume and log writes', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page, 1440, 7, [], false);
    const choice = () =>
      page.evaluate(`import('/src/ui/app.ts').then(({ _debug }) => {
      const g = _debug.game();
      return { initial: g.plainEnglish, actors: [...g.valley.people, g.valley.kahya].every(p => p.lexicon?.plainEnglish === false) };
    })`);
    expect(await choice()).toEqual({ initial: false, actors: true });
    await page.evaluate(
      `import('/src/ui/app.ts').then(({ _debug }) => _debug.order({ verb: 'visit', house: 'coban' }))`,
    );
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('valley-log-v1') ?? '{}').plainEnglish),
    ).toBe(false);
    await page.reload();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    for (let i = 0; i < 100 && !(await page.locator('#map').count()); i++) await page.clock.runFor(50);
    expect(await choice()).toEqual({ initial: false, actors: true });
  } finally {
    await page.close();
  }
});

it('refuses a legacy local log without a pinned narration choice', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await page.goto(origin);
    const legacy = JSON.stringify({
      game: 'valley',
      version: '0.3.0',
      seed: 7,
      inputs: [],
      minute: 1440,
      volume: 0,
    });
    await page.evaluate((text) => localStorage.setItem('valley-log-v1', text), legacy);
    await page.reload();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect.poll(() => page.locator('body').innerText()).toMatch(/Start a new game from the title page/);
    expect(await page.evaluate(() => localStorage.getItem('valley-log-v1'))).toBe(legacy);
  } finally {
    await page.close();
  }
});

it('describes unnamed adults and children together on household cards', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page);
    await page.locator('#houses [data-h="ak"]').click();
    await page.getByRole('button', { name: 'About ▾', exact: true }).click();
    const text = await page.locator('#sheet').innerText();
    expect(text).toContain('5 people');
    expect(text).not.toMatch(/A child|a household member|5 other people/);
    await fits(page);
  } finally {
    await page.close();
  }
});
