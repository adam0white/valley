import type { ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { RulesEdition } from '../src/sim/edition.ts';
import { compactRun, type Input, newGame, save, step } from '../src/sim/game.ts';
import { startBrowserServer, visibleText } from './browser-server.ts';

let server: ChildProcess;
let browser: Browser;
let origin: string;
let preserveForeignBrowser = false;
beforeAll(async () => {
  ({ server, origin } = await startBrowserServer('ui-test'));
  browser = await chromium.launch();
}, 30000);
afterAll(async () => {
  if (!preserveForeignBrowser) {
    server?.kill('SIGTERM');
    await browser?.close();
  }
}, 30000);

async function open(
  page: Page,
  minute = 360,
  seed = 406153184,
  inputs: Input[] = [],
  plainEnglish = true,
  rules?: RulesEdition,
) {
  page.setDefaultTimeout(4000);
  await page.clock.install();
  await page.goto(origin);
  await page.clock.pauseAt(Date.now() + 500);
  await page.evaluate(
    ({ minute, seed, inputs, plainEnglish, rules }) =>
      localStorage.setItem(
        'valley-log-v1',
        JSON.stringify({
          game: 'valley',
          version: '0.3.1',
          seed,
          inputs,
          minute,
          volume: 0,
          plainEnglish,
          ...(rules ? { rules } : {}),
        }),
      ),
    { minute, seed, inputs, plainEnglish, rules },
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
      const map = e.parentElement?.getBoundingClientRect();
      const goal = e.getBoundingClientRect();
      const steward = document.querySelector('#steward')?.getBoundingClientRect();
      if (!map || !steward) throw new Error('Missing play scene');
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
    expect(await visibleText(page.locator('#steward'))).toMatch(/walking to/);
    expect(await page.locator('.house-response').count()).toBe(0);
    await page.locator('.house-about').click();
    expect(await visibleText(page.locator('#sheet'))).not.toContain('by the fire');
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
    expect(await visibleText(page.locator('.current-notes'))).toContain('Old word');
    await page.evaluate(`(async () => {
      const { _debug } = await import('/src/ui/app.ts');
      const { note } = await import('/src/sim/valley.ts');
      const s = _debug.game().valley;
      note(s, { at: s.minute, kind: 'voice', text: 'A new word at the door', weight: 4 });
    })()`);
    await page.clock.runFor(1000);
    expect(await visibleText(page.locator('.current-notes'))).toContain('A new word at the door');
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
    expect(await visibleText(replies)).toMatch(/came|put off|refused/);
    expect(await visibleText(page.locator('#houses'))).toContain('●');
  } finally {
    await page.close();
  }
});

// Hold to insist has a non-hold way in: the first tap arms it, a second tap insists.
it('insists on a refusal by tapping its hold button twice', async () => {
  const inputs: Input[] = [{ verb: 'call', job: 'reap-agha', houses: ['coban'], at: 750 }];
  const page = await browser.newPage({ viewport: { width: 360, height: 690 }, hasTouch: true });
  try {
    await page.route('**/api/**', (route) => route.abort());
    await open(page, 990, 42, inputs);
    await page.locator('#houses [data-h="coban"]').click();
    const insists = () =>
      page.evaluate<number>(
        `import('/src/ui/app.ts').then(({ _debug }) => _debug.game().inputs.filter((i) => i.verb === 'insist').length)`,
      );
    const press = page.locator('.decision-reply .hold').first();
    await press.scrollIntoViewIfNeeded();
    await press.tap();
    expect(await insists()).toBe(0);
    expect(await press.getAttribute('class')).toContain('armed');
    expect(await page.locator('#sheet').textContent()).toContain('Tap again to confirm');
    await page.locator('.decision-reply .hold').first().tap();
    expect(await insists()).toBe(1);
  } finally {
    await page.close();
  }
});

it('reads a named refusal, cancels and completes one hold, then visits and confirms grain on a phone', async () => {
  const inputs: Input[] = [{ verb: 'call', job: 'reap-agha', houses: ['coban'], at: 750 }];
  const page = await browser.newPage({ viewport: { width: 360, height: 690 }, hasTouch: true });
  try {
    await page.route('**/api/**', (route) => route.abort());
    await open(page, 990, 42, inputs);
    await page.locator('#houses [data-h="coban"]').click();
    const facts = () =>
      page.evaluate<{
        ask: string;
        pid: string;
        name: string;
        reply: { at: number; says: string; verdict: string };
        replies: Record<string, { at: number; says: string; verdict: string }>;
        insisted: string[];
        inputs: Input[];
        granary: number;
        visit: { arrive: number; leave: number; back: number };
        minute: number;
      }>(`import('/src/ui/app.ts').then(({ _debug }) => {
      const g = _debug.game(), s = g.valley, a = s.asks.at(-1);
      const [pid, reply] = Object.entries(a.replies).filter(([id,r]) => s.households.find(h => h.id === 'coban').members.includes(id) && !a.insisted.includes(id) && ['deferred','refused','modified'].includes(r.verdict)).sort((a,b) => b[1].at-a[1].at)[0] ?? [];
      return { ask: a.id, pid, name: s.people.find(p => p.id === pid)?.name, reply, replies: a.replies, insisted: [...a.insisted], inputs: g.inputs, granary: s.agha.granary, visit: s.kahyaState.visit, minute: s.minute };
    })`);
    const before = await facts();
    const reply = page.locator('.decision-reply');
    expect(await visibleText(reply)).toContain(before.reply.says);
    expect(await visibleText(reply)).toContain('own barley');
    expect(await visibleText(reply)).toMatch(/18 July, year one/);
    await page.locator('#sheet').evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    await reply.scrollIntoViewIfNeeded();
    expect(await reply.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    const press = page.locator('.decision-reply .hold');
    const bounds = await press.boundingBox();
    if (!bounds) throw new Error('Missing real hold control');
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.clock.runFor(300);
    expect(await press.locator('.hold-progress').textContent()).toMatch(/%/);
    expect((await facts()).inputs).toEqual(before.inputs);
    await page.mouse.move(0, 0);
    await page.mouse.up();
    expect(await press.locator('.hold-progress').textContent()).toBe('');
    await page.clock.runFor(700);
    expect((await facts()).inputs).toEqual(before.inputs);
    await press.focus();
    await page.keyboard.down('Enter');
    await page.clock.runFor(300);
    const progress = Number.parseFloat(
      await press.evaluate((e) => e.style.getPropertyValue('--hold-progress')),
    );
    expect(progress).toBeGreaterThan(30);
    expect(progress).toBeLessThan(60);
    expect((await facts()).inputs).toEqual(before.inputs);
    await page.keyboard.up('Enter');
    expect(await press.locator('.hold-progress').textContent()).toBe('');
    expect(await press.evaluate((e) => e.style.getPropertyValue('--hold-progress'))).toBe('0%');
    await page.clock.runFor(700);
    expect((await facts()).inputs).toEqual(before.inputs);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await press.focus();
    await page.keyboard.down('Enter');
    await page.clock.runFor(300);
    expect(await press.locator('.hold-progress').textContent()).toMatch(/%/);
    expect((await facts()).inputs).toEqual(before.inputs);
    await page.clock.runFor(350);
    await page.keyboard.up('Enter');
    const after = await facts();
    const insist = after.inputs.filter((i: Input) => i.verb === 'insist');
    expect(insist).toHaveLength(1);
    expect(insist[0]).toMatchObject({ verb: 'insist', ask: before.ask, pid: before.pid });
    expect(after.insisted).toEqual([...before.insisted, before.pid]);
    const receipt = await visibleText(page.locator('#action-receipt'));
    expect(receipt).toContain(`You insisted that ${before.name}`);
    expect(receipt).toContain('cut the landowner’s barley');
    expect(receipt).toContain(
      JSON.stringify(after.replies[before.pid]) === JSON.stringify(before.reply)
        ? 'Their next answer is pending.'
        : (after.replies[before.pid]?.says ?? 'Missing current answer'),
    );
    for (const [pid, r] of Object.entries(before.replies))
      if (pid !== before.pid) expect(after.replies[pid]).toEqual(r);
    await page.getByRole('button', { name: 'About ▾', exact: true }).click();
    const actual = await facts();
    const counts = Object.values(actual.replies).reduce(
      (c: Record<string, number>, r: { verdict: string }) => {
        const key =
          r.verdict === 'deferred'
            ? 'delayed'
            : r.verdict === 'refused'
              ? 'refused'
              : r.verdict === 'modified'
                ? 'modified'
                : r.verdict === 'assented'
                  ? 'agreed'
                  : 'pressured';
        c[key] = (c[key] ?? 0) + 1;
        return c;
      },
      {} as Record<string, number>,
    );
    const countText = await visibleText(page.locator('.reply-count'));
    expect(countText).toContain(`${counts.agreed ?? 0} agreed`);
    expect(countText).toContain(`${counts.pressured ?? 0} answered under pressure`);
    expect(countText).toContain(`${counts.delayed ?? 0} delayed`);
    expect(countText).toContain(`${counts.refused ?? 0} refused`);
    await page.getByRole('button', { name: 'Visit', exact: true }).click();
    const visit = await facts();
    expect(await visibleText(page.locator('#reading-travel'))).toContain('walking to the Çoban house');
    expect(await visibleText(page.locator('#reading-travel'))).toContain(
      `${visit.visit.arrive - visit.minute} game minutes until arrival; ${visit.visit.back - visit.minute} until home.`,
    );
    // Open delayed replies no longer hold the clock at its slowest. Wait past arrival and its first spoken lines.
    for (let i = 0; i < 60 && (await facts()).minute < visit.visit.arrive + 40; i++)
      await page.clock.runFor(1000);
    const attended = await facts();
    expect(attended.minute).toBeGreaterThanOrEqual(attended.visit.arrive);
    expect(attended.minute).toBeLessThan(attended.visit.leave);
    expect(await visibleText(page.locator('#reading-travel'))).toContain(
      `at the Çoban house. ${attended.visit.leave - attended.minute} game minutes left here; ${attended.visit.back - attended.minute} until home.`,
    );
    const control = page.getByRole('button', { name: 'Send grain', exact: true });
    const sameControl = await control.elementHandle();
    await control.focus();
    const scroll = await page.locator('#sheet').evaluate((e) => {
      e.scrollTop = e.scrollHeight;
      return e.scrollTop;
    });
    // Let the clock move within the visit.
    for (let i = 0; i < 30 && (await facts()).minute <= attended.minute; i++) await page.clock.runFor(1000);
    const countdown = await facts();
    expect(countdown.minute).toBeGreaterThan(attended.minute);
    expect(countdown.minute).toBeLessThan(countdown.visit.leave);
    expect(
      await control.evaluate((e, original) => e === original, sameControl),
      JSON.stringify({ attended, countdown }),
    ).toBe(true);
    expect(await control.evaluate((e) => e === document.activeElement)).toBe(true);
    expect(await page.locator('#sheet').evaluate((e) => e.scrollTop)).toBe(scroll);
    // Read every current reply line through its real scroll container.
    const current = page.locator('.house-response');
    if (await current.count()) {
      await current.scrollIntoViewIfNeeded();
      expect(await current.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    }
    const grainBefore = await facts();
    await control.click();
    expect((await facts()).inputs).toEqual(grainBefore.inputs);
    expect(await visibleText(page.locator('.pending-grain'))).toContain(
      `Send ${Math.min(6, grainBefore.granary)} measures of grain to the Çoban house`,
    );
    expect(
      await page.locator('#sheet').evaluate((e) => {
        const body = e.getBoundingClientRect(),
          thumbs = document.querySelector('#thumbs')?.getBoundingClientRect();
        if (!thumbs) throw new Error('Missing real controls');
        const measured = Number.parseFloat(
          getComputedStyle(document.querySelector('.play') as Element).getPropertyValue('--thumbs-height'),
        );
        return (
          body.height > 0 &&
          body.bottom <= thumbs.top + 1 &&
          thumbs.bottom <= innerHeight &&
          Math.abs(measured - thumbs.height) < 1
        );
      }),
    ).toBe(true);
    await page.locator('#now').evaluate((e) => {
      e.style.fontSize = '34px';
    });
    await page.locator('.house-response .w').evaluateAll((es) => {
      for (const e of es) (e as HTMLElement).style.fontSize = '34px';
    });
    await page.clock.runFor(50);
    await expect.poll(() => page.locator('.play').getAttribute('data-reflow')).toBe('true');
    expect(
      await page.locator('#sheet').evaluate((e) => {
        const body = e.getBoundingClientRect(),
          thumbs = document.querySelector('#thumbs')?.getBoundingClientRect();
        if (!thumbs) throw new Error('Missing actual pending controls');
        e.scrollTop = e.scrollHeight;
        return (
          body.height > 0 &&
          body.bottom <= thumbs.top + 1 &&
          e.scrollTop + e.clientHeight >= e.scrollHeight - 1
        );
      }),
    ).toBe(true);
    await page.getByRole('button', { name: 'Confirm send grain', exact: true }).click();
    const grainAfter = await facts();
    expect(grainAfter.inputs.filter((i: Input) => i.verb === 'give')).toHaveLength(1);
    expect(grainAfter.inputs.at(-1)).toMatchObject({ verb: 'give', house: 'coban', kile: 6 });
    expect(await visibleText(page.locator('#action-receipt'))).toContain(
      `Dispatched ${Math.min(6, grainBefore.granary)} measures to the Çoban house.`,
    );
    expect(await visibleText(page.locator('#action-receipt'))).toContain(
      `Net granary cost: ${grainBefore.granary - grainAfter.granary} measures. Your granary now holds ${grainAfter.granary} measures.`,
    );
    await page.locator('#sheet').evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    expect(
      await page.locator('#sheet').evaluate((e) => e.scrollTop + e.clientHeight >= e.scrollHeight - 1),
    ).toBe(true);
    await page.locator('#now').evaluate((e) => {
      e.style.removeProperty('font-size');
    });
    await page.clock.runFor(50);
    await expect.poll(() => page.locator('.play').getAttribute('data-reflow')).toBe('false');
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
    expect(await visibleText(page.locator('#action-receipt'))).toMatch(
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
    expect(await visibleText(popover)).toMatch(/You are the steward.*landowner’s grain.*grain measures/s);
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
            new Response(bytes).body?.pipeThrough(new DecompressionStream('gzip')),
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
    const receipt = await page.evaluate(
      () => JSON.parse(localStorage.getItem('valley-log-v1') ?? 'null').continuity,
    );
    await page.evaluate(() => {
      window.CompressionStream = class {
        constructor() {
          throw new Error('Simulated unloading compression failure');
        }
      } as unknown as typeof CompressionStream;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.runFor(50);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('valley-log-v1') ?? 'null'));
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

it('loads a compact playtest run through isolated public Debug and restores its fingerprint', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  const run = compactRun(save(newGame(7)));
  try {
    await page.goto(`${origin}/?lab=1`);
    await fits(page);
    await page.locator('[data-menu]').click();
    await page.locator('.menu-debug summary').click();
    await page.getByRole('link', { name: 'Open a Valley file', exact: true }).click();
    await page.getByLabel('Open a Valley file').setInputFiles({
      name: 'compact.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(run)),
    });
    await expect.poll(() => page.locator('#map').isVisible()).toBe(true);
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
    expect(await visibleText(reader)).toContain('UI present notebook note');
    expect(await visibleText(reader)).not.toContain('UI future notebook note');
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
    expect(await visibleText(reader)).toContain('UI completed notebook note');
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

it('opens the ledger below the household controls', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page);
    await page.getByRole('button', { name: 'The ledger ▸', exact: true }).click();
    expect((await page.locator('.lk-sheet').boundingBox())?.y).toBeCloseTo(332, 0);
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
        const goal = document.querySelector<HTMLElement>('#now');
        const caption = document.querySelector<HTMLElement>('.action-caption');
        const body = document.querySelector<HTMLElement>('#sheet');
        const actions = document.querySelector<HTMLElement>('#thumbs');
        if (!goal || !caption || !body || !actions) throw new Error('Missing house layout');
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
    await page.getByRole('button', { name: 'Call this house to cut barley', exact: true }).click();
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
      version: '0.3.1',
      seed: 7,
      inputs: [],
      minute: 1440,
      volume: 0,
    });
    await page.evaluate((text) => localStorage.setItem('valley-log-v1', text), legacy);
    await page.reload();
    await page.locator('.title-premise').waitFor();
    expect(await page.getByRole('button', { name: 'Resume', exact: true }).count()).toBe(0);
    expect(await page.locator('body').textContent()).toMatch(/malformed or incompatible/);
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
    const text = await visibleText(page.locator('#sheet'));
    expect(text).toContain('5 people');
    expect(text).not.toMatch(/A child|a household member|5 other people/);
    await fits(page);
  } finally {
    await page.close();
  }
});

it('offers an introductory visit and names the household a call reaches', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page, 360, 7);
    await page.locator('#houses [data-h="coban"]').click();
    await page.getByRole('button', { name: 'About ▾', exact: true }).click();
    expect(await page.locator('#sheet').textContent()).not.toMatch(
      /postpones your request|only send requests/,
    );
    await page.getByRole('button', { name: 'Visit', exact: true }).click();
    await page.clock.runFor(50);
    expect((await state(page)).inputs).toContain('"verb":"visit"');
    expect(await visibleText(page.locator('#steward'))).toMatch(/walking to/);
    const call = page.getByRole('button', { name: 'Call this house to cut barley', exact: true });
    await call.click();
    const inputs = JSON.parse((await state(page)).inputs);
    if (inputs.at(-1)?.verb !== 'call') {
      // A house with almost no food asks for a second press first, because a call cannot be taken back.
      expect(await visibleText(page.locator('.action-caption'))).toMatch(/cannot be taken back/);
      await page.getByRole('button', { name: /Call this house to cut barley/ }).click();
    }
    expect(JSON.parse((await state(page)).inputs).at(-1)).toMatchObject({ verb: 'call', houses: ['coban'] });
    expect(await visibleText(page.locator('.action-caption'))).toMatch(/only.*Çoban house/);
  } finally {
    await page.close();
  }
});

it('keeps household selection reachable while the ledger is open on a phone', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page);
    await page.getByRole('button', { name: 'The ledger ▸', exact: true }).click();
    const house = page.getByRole('button', { name: 'the Çoban house', exact: true });
    expect(
      await house.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }),
    ).toBe(true);
    await house.click();
    expect(await house.getAttribute('aria-pressed')).toBe('true');
    expect(await page.getByRole('button', { name: 'About ▾', exact: true }).isVisible()).toBe(true);
    await fits(page);
  } finally {
    await page.close();
  }
});

it('keeps the rain deadline and complete immediate reply visible with About open on a phone', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page, 360, 7);
    await page.getByRole('button', { name: 'the Kavak house', exact: true }).click();
    await page.getByRole('button', { name: 'About ▾', exact: true }).click();
    await page.getByRole('button', { name: 'Call this house to cut barley', exact: true }).click();
    await page.clock.runFor(30000);
    await page.evaluate(() => document.fonts.ready);
    const response = page.locator('.house-response');
    expect(await response.count()).toBe(1);
    expect(await visibleText(response)).toMatch(/“.+”/);
    expect(
      await response.evaluate((e) => {
        const r = e.getBoundingClientRect();
        const body = e.closest('#sheet')?.getBoundingClientRect();
        if (!body) throw new Error('Missing reply sheet');
        return r.top >= body.top && r.bottom <= body.bottom && e.scrollWidth <= e.clientWidth;
      }),
    ).toBe(true);
    expect(await visibleText(page.locator('.grain-label'))).toContain('Rain is due on 20 July.');
    expect(await page.locator('.grain-label').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    await fits(page);
  } finally {
    await page.close();
  }
});

it.each([
  [360, 690],
  [1280, 800],
])('keeps complete clock guidance clear of the travel caption at %ix%i', async (width, height) => {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.route('**/api/**', (route) => route.abort());
    await open(page, 420, 7, [], true, 'valley-replies-2026-10');
    await page.getByRole('button', { name: 'the Kavak house', exact: true }).click();
    await page.getByRole('button', { name: 'Visit', exact: true }).click();
    await page.clock.runFor(16000);
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => {
      const goal = document.querySelector<HTMLElement>('#now');
      const pace = document.querySelector<HTMLElement>('#pace') ?? goal;
      const travel = document.querySelector<HTMLElement>('#steward');
      if (!goal || !pace || !travel) throw new Error('Missing guidance');
      const a = goal.getBoundingClientRect(),
        b = travel.getBoundingClientRect(),
        c = pace.getBoundingClientRect();
      const separate = (r: DOMRect, s: DOMRect) =>
        r.bottom <= s.top || s.bottom <= r.top || r.right <= s.left || s.right <= r.left;
      return {
        clear: separate(a, b) && separate(c, b),
        complete: pace.scrollWidth <= pace.clientWidth + 1 && pace.scrollHeight <= pace.clientHeight + 1,
        visible: c.top >= 0 && c.bottom <= innerHeight,
      };
    });
    expect(layout).toEqual({ clear: true, complete: true, visible: true });
    expect(await visibleText(page.locator('#now'))).toContain('Your visit is underway');
    await fits(page);
  } finally {
    await page.close();
  }
});

it('offers the opt-in answer at first arrival without reopening the household', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await page.route('**/api/**', (route) => route.abort());
    await open(page, 450, 7, [], true, 'valley-replies-2026-10');
    await page.getByRole('button', { name: 'the Kavak house', exact: true }).click();
    await page.getByRole('button', { name: 'Send grain', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm send grain', exact: true }).click();
    await page.getByRole('button', { name: 'Visit', exact: true }).click();
    expect(await page.getByRole('button', { name: /^Say: I came to listen/ }).count()).toBe(0);
    for (let i = 0; i < 30; i++) {
      await page.clock.runFor(1000);
      if ((await visibleText(page.locator('#steward'))).includes('at the Kavak house')) break;
    }
    expect(await visibleText(page.locator('#steward'))).toContain('at the Kavak house');
    const answer = page.getByRole('button', { name: /^Say: I came to listen/ });
    expect(await answer.count()).toBe(1);
    expect(await answer.isEnabled()).toBe(true);
    await answer.click();
    expect(await answer.isEnabled()).toBe(false);
    expect(await visibleText(page.locator('.action-caption'))).toContain('You said:');
  } finally {
    await page.close();
  }
});

// Grain confirmation must guard the actual household action, not only a receipt helper.
it('previews grain without recording an order or spending stock', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await page.route('**/api/**', (route) => route.abort());
    await open(page, 450, 7, [], true, 'valley-replies-2026-10');
    await page.getByRole('button', { name: 'the Kavak house', exact: true }).click();
    const before = await state(page);
    await page.getByRole('button', { name: 'Send grain', exact: true }).click();
    expect(await state(page)).toEqual(before);
    expect(await visibleText(page.locator('.action-caption'))).toContain(
      '6 measures of grain to the Kavak house',
    );
    expect(await page.getByRole('button', { name: 'Confirm send grain', exact: true }).count()).toBe(1);
  } finally {
    await page.close();
  }
});

it('guards grain cancel, changed stock, recipient changes and repeated confirmation', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await page.route('**/api/**', (route) => route.abort());
    await open(page, 450, 7, [], true, 'valley-replies-2026-10');
    await page.getByRole('button', { name: 'the Kavak house', exact: true }).click();
    const snapshot = () =>
      page.evaluate<{ stock: number; inputs: Input[] }>(
        `import('/src/ui/app.ts').then(({ _debug }) => ({ stock: _debug.game().valley.agha.granary, inputs: _debug.game().inputs }))`,
      );
    const before = await snapshot();
    await page.getByRole('button', { name: 'Send grain', exact: true }).click();
    expect(await snapshot()).toEqual(before);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await snapshot()).toEqual(before);
    expect(await page.locator('#houses [data-h="kavak"]').getAttribute('aria-pressed')).toBe('true');
    await page.getByRole('button', { name: 'Send grain', exact: true }).click();
    await page.evaluate(
      `import('/src/ui/app.ts').then(({ _debug }) => { _debug.game().valley.agha.granary = 3.25; })`,
    );
    await page.getByRole('button', { name: 'Confirm send grain', exact: true }).click();
    expect(await snapshot()).toEqual({ stock: 3.25, inputs: [] });
    expect(await visibleText(page.locator('.action-caption'))).toContain(
      '3.25 measures of grain to the Kavak house',
    );
    // Reenter the still-mounted confirmation during the actual log write.
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        Storage.prototype.setItem = original;
        document.querySelector<HTMLButtonElement>('#thumbs button[data-grain-confirm]')?.click();
        return original.call(this, key, value);
      };
      const button = [...document.querySelectorAll<HTMLButtonElement>('#thumbs button')].find(
        (b) => b.textContent === 'Confirm send grain',
      );
      button?.setAttribute('data-grain-confirm', '');
    });
    await page.getByRole('button', { name: 'Confirm send grain', exact: true }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    expect(await snapshot()).toEqual({
      stock: 0,
      inputs: [{ verb: 'give', house: 'kavak', kile: 6, at: 450 }],
    });
    expect(await visibleText(page.locator('.action-caption'))).toContain(
      'Dispatched 3.25 measures to the Kavak house.',
    );
    // Compare the native payload and full world delta against the unchanged action path.
    expect(
      await page.evaluate(`Promise.all([import('/src/ui/app.ts'), import('/src/sim/game.ts')]).then(([{ _debug }, { newGame, step, act, stateJson }]) => {
      const expected = newGame(7, undefined, false, true, 'valley-replies-2026-10'); step(expected, 450); expected.valley.agha.granary = 3.25;
      act(expected, { verb: 'give', house: 'kavak', kile: 6 });
      return JSON.stringify(stateJson(expected.valley)) === JSON.stringify(stateJson(_debug.game().valley));
    })`),
    ).toBe(true);
    await page.evaluate(
      `import('/src/ui/app.ts').then(({ _debug }) => { _debug.game().valley.agha.granary = 6; _debug.skipTo(0); })`,
    );
    await page.getByRole('button', { name: 'Send grain', exact: true }).click();
    await page.locator('#houses [data-h="coban"]').click();
    expect(await page.getByRole('button', { name: 'Confirm send grain', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Send grain', exact: true }).click();
    await page.evaluate(
      `import('/src/ui/app.ts').then(({ _debug }) => { _debug.game().valley.flags.verbs = _debug.game().valley.flags.verbs.filter(v => v !== 'give'); })`,
    );
    await page.getByRole('button', { name: 'Confirm send grain', exact: true }).click();
    expect((await snapshot()).stock).toBe(6);
    expect((await snapshot()).inputs).toHaveLength(1);
    expect(await page.getByRole('button', { name: 'Confirm send grain', exact: true }).count()).toBe(0);
  } finally {
    await page.close();
  }
});

it('keeps the pending grain disclosure after a blocked Visit click', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await page.route('**/api/**', (route) => route.abort());
    await open(page, 450, 7, [], true, 'valley-replies-2026-10');
    await page.getByRole('button', { name: 'the Kavak house', exact: true }).click();
    await page.getByRole('button', { name: 'Visit', exact: true }).click();
    const before = await state(page);
    await page.getByRole('button', { name: 'Send grain', exact: true }).click();
    expect(await state(page)).toEqual(before);
    const visit = page.getByRole('button', { name: 'Visit', exact: true });
    expect(await visit.getAttribute('aria-disabled')).toBe('true');
    // aria-disabled buttons still receive ordinary DOM clicks in this application.
    await visit.evaluate((button) => (button as HTMLButtonElement).click());
    expect(await visibleText(page.locator('.action-caption'))).toMatch(/Visit: /);
    expect(await page.getByRole('button', { name: 'Confirm send grain', exact: true }).count()).toBe(1);
    expect(await visibleText(page.locator('#thumbs'))).toContain(
      'Send 6 measures of grain to the Kavak house?',
    );
    expect(await state(page)).toEqual(before);
    await page.getByRole('button', { name: 'Confirm send grain', exact: true }).click();
    const after = await state(page);
    expect(after.minute).toBe(before.minute);
    expect(JSON.parse(after.inputs)).toEqual([
      ...JSON.parse(before.inputs),
      { verb: 'give', house: 'kavak', kile: 6, at: 450 },
    ]);
  } finally {
    await page.close();
  }
});

it('offers the public term and preserves two actual old Zehra scene lines in the existing reading panel', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await page.goto(`${origin}/?lab=1`);
    await page.evaluate(() => localStorage.setItem('valley-log-v1', '{"malformed":true}'));
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.locator('.edition-choice input').count()).toBe(0);
    const start = page.getByRole('button', { name: 'New game', exact: true });
    await start.scrollIntoViewIfNeeded();
    const geometry = await start.evaluate((e) => ({
      rect: e.getBoundingClientRect().toJSON(),
      height: innerHeight,
      width: document.documentElement.scrollWidth,
      page: (document.querySelector('.title-page') as HTMLElement).scrollTop,
      pageHeight: (document.querySelector('.title-page') as HTMLElement).scrollHeight,
    }));
    expect(geometry.rect.bottom <= 690 && geometry.rect.right <= 360, JSON.stringify(geometry)).toBe(true);
    await open(
      page,
      1110,
      7,
      [
        { at: 420, verb: 'call', job: 'reap-agha', houses: ['coban'] },
        { at: 1080, verb: 'visit', house: 'coban' },
      ],
      true,
      'valley-dialogue-2026-10',
    );
    await page.getByRole('button', { name: 'the Çoban house', exact: true }).click();
    const follow = page.getByRole('button', {
      name: 'You said, “Who will feed my family while I cut his barley?” What would you like me to know about that?',
      exact: true,
    });
    expect(await follow.count()).toBe(1);
    expect(
      await page
        .getByRole('button', {
          name: 'Rain is due on 20 July. I need hands to cut the landowner’s barley. Can you help before then?',
          exact: true,
        })
        .count(),
    ).toBe(1);
    expect(await page.locator('#sheet .dialogue').count()).toBe(1);
    await follow.click();
    expect(
      await page
        .getByText('Your question is waiting to reach Zehra. No answer yet.', { exact: true })
        .count(),
    ).toBe(1);
    await page.getByRole('button', { name: 'End this question', exact: true }).click();
    const recorded = await page.evaluate<{
      inputs: Input[];
      exchange: { status: string; answerNote?: number };
    }>(
      `import('/src/ui/app.ts').then(({_debug})=>({inputs:_debug.game().inputs,exchange:_debug.game().valley.dialogue.exchanges[0]}))`,
    );
    expect(recorded.inputs.filter((i: Input) => i.verb === 'dialogue')).toHaveLength(1);
    expect(recorded.exchange.status).toBe('cancelled');
    expect(recorded.exchange.answerNote).toBeUndefined();
  } finally {
    await page.close();
  }
});

it.each<{ name: string; minute: number; inputs: Input[] }>([
  {
    name: 'pending',
    minute: 1110,
    inputs: [
      { verb: 'call', job: 'reap-agha', houses: ['coban'], at: 420 },
      { verb: 'visit', house: 'coban', at: 1080 },
      {
        verb: 'dialogue',
        turn: 0,
        house: 'coban',
        person: 'zehra',
        visit: 1100,
        prior: 5,
        line: 'follow-up',
        at: 1110,
      },
    ],
  },
  {
    name: 'withheld',
    minute: 1140,
    inputs: [
      { verb: 'call', job: 'reap-agha', houses: ['coban'], at: 420 },
      { verb: 'visit', house: 'coban', at: 1080 },
      {
        verb: 'dialogue',
        turn: 0,
        house: 'coban',
        person: 'zehra',
        visit: 1100,
        prior: 5,
        line: 'follow-up',
        at: 1110,
      },
    ],
  },
  {
    name: 'cancelled',
    minute: 1230,
    inputs: [
      { verb: 'call', job: 'reap-agha', houses: ['coban'], at: 420 },
      { verb: 'visit', house: 'coban', at: 1080 },
      {
        verb: 'dialogue',
        turn: 0,
        house: 'coban',
        person: 'zehra',
        visit: 1100,
        prior: 5,
        line: 'work-need',
        ask: 'a1-420',
        at: 1110,
      },
      { verb: 'dialogue-cancel', turn: 0, at: 1110 },
    ],
  },
])('replays authoritative dialogue recovery ($name)', async ({ name, minute, inputs }) => {
  const page = await browser.newPage();
  // Reconstruct every expected field from the same public accepted input prefix.
  const replay = newGame(7, undefined, false, true, 'valley-dialogue-2026-10');
  step(replay, minute, inputs);
  expect(replay.inputs).toEqual(inputs);
  const expected = save(replay);
  try {
    await page.clock.install();
    await page.goto(origin);
    await page.clock.pauseAt(Date.now() + 500);
    const inventory = await page.evaluate(async () => ({
      databases: await indexedDB.databases(),
      storageKeys: Object.keys(localStorage),
      caches: await caches.keys(),
      serviceWorkers: (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope),
    }));
    console.log('Dialogue recovery fresh-context inventory', name, inventory);
    for (const forged of name === 'withheld' ? [true, false] : [false]) {
      await page.evaluate(
        async ({ expected, inputs, minute, forged }) => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const r = indexedDB.open('valley', 1);
            r.onupgradeneeded = () => r.result.createObjectStore('volumes');
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          });
          // Inventory the fresh test context before writing its exact task-owned records.
          const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
            const r = db.transaction('volumes').objectStore('volumes').getAllKeys();
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          });
          if (keys.some((key) => key !== 'current')) throw new Error('Unexpected recovery key');
          // The forged wire payload deliberately violates native receipt types.
          const state = JSON.parse(JSON.stringify(expected.state));
          if (forged) {
            const e = state.dialogue.exchanges[0];
            e.status = 'completed';
            e.endedAt = 1119;
            e.activity = { startedAt: 1114, endsAt: 1119 };
            e.answerNote = 1;
            e.answer = { at: 1119, words: 'FORGED completed answer' };
            e.work = { reply: { verdict: 'accepted', says: 'FORGED work answer' } };
          }
          const json = JSON.stringify(state);
          const digest = [
            ...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json))),
          ]
            .map((n) => n.toString(16).padStart(2, '0'))
            .join('');
          const gz = await new Response(
            new Blob([json]).stream().pipeThrough(new CompressionStream('gzip')),
          ).blob();
          const runId = 'dialogue-recovery-test';
          localStorage.setItem(
            'valley-log-v1',
            JSON.stringify({
              game: 'valley',
              version: '0.3.1',
              seed: 7,
              rules: expected.rules,
              inputs,
              minute,
              volume: 0,
              plainEnglish: true,
              continuity: { runId },
            }),
          );
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('volumes', 'readwrite');
            tx.objectStore('volumes').put(
              {
                seed: 7,
                rules: expected.rules,
                k: inputs.length,
                inputLog: JSON.stringify(inputs),
                minute,
                runId,
                digest,
                gz,
              },
              'current',
            );
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
          db.close();
        },
        { expected, inputs, minute, forged },
      );
      await page.reload();
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
      for (let i = 0; i < 100 && !(await page.locator('#map').count()); i++) await page.clock.runFor(50);
      const actual = await page.evaluate(`import('/src/ui/app.ts').then(async ({_debug}) => {
          const { stateJson, newGame, step } = await import('/src/sim/game.ts');
          const current = _debug.game();
          const replay = newGame(7, undefined, false, true, 'valley-dialogue-2026-10');
          step(replay, current.valley.minute, current.inputs);
          return { state: stateJson(current.valley), inputs: current.inputs, replay: stateJson(replay.valley) };
        })`);
      const result = actual as { state: unknown; inputs: unknown; replay: unknown };
      expect(result.state).toEqual(result.replay);
      expect(JSON.stringify({ state: result.state, inputs: result.inputs })).toBe(
        JSON.stringify({ state: expected.state, inputs }),
      );
    }
  } finally {
    await page.close();
  }
});

it('opens a foreign file without reading or replacing occupied native storage or constructing the Shelf', async () => {
  const page = await browser.newPage();
  try {
    await page.route('**/src/main.ts', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
    );
    await page.goto(origin);
    await page.evaluate(async () => {
      localStorage.setItem('valley-log-v1', 'occupied-owner-log');
      localStorage.setItem('hf-persona-opt-in', '0');
      await new Promise<void>((resolve) => {
        const request = indexedDB.open('valley', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('volumes');
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('volumes', 'readwrite');
          tx.objectStore('volumes').put({ owner: true, gz: new Blob(['owner-current']) }, 'current');
          tx.objectStore('volumes').put({ owner: true, gz: new Blob(['owner-history']) }, 'history:owner');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      });
    });
    await page.addInitScript(() => {
      const target = window as unknown as {
        nativeReads: number;
        nativeWrites: number;
        swRegistrations: number;
      };
      target.nativeReads = 0;
      target.nativeWrites = 0;
      target.swRegistrations = 0;
      const get = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) {
        if (key === 'valley-log-v1') target.nativeReads++;
        return get.call(this, key);
      };
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'valley-log-v1') target.nativeWrites++;
        return set.call(this, key, value);
      };
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = (name, version) => {
        if (name === 'valley') target.nativeReads++;
        return open(name, version);
      };
      navigator.serviceWorker.register = async () => {
        target.swRegistrations++;
        throw new Error('unexpected registration');
      };
    });
    await page.unroute('**/src/main.ts');
    await page.clock.install();
    await page.goto(`${origin}/file/`);
    await page.clock.pauseAt(Date.now() + 50);
    await expect.poll(() => page.getByLabel('Open a Valley file').count()).toBe(1);
    // Compare the exact uploaded JSON wire file, not the pre-serialization native -0 values.
    const fileBytes = process.env.VALLEY_SELECTED_FILE
      ? readFileSync(process.env.VALLEY_SELECTED_FILE)
      : Buffer.from(JSON.stringify(save(newGame(7), 0)));
    const file = JSON.parse(fileBytes.toString('utf8'));
    await page.getByLabel('Open a Valley file').setInputFiles({
      name: 'valley.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(file)),
    });
    await expect.poll(() => page.locator('#map').count()).toBe(1);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const pendingDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download this Valley file', exact: true }).click();
    const download = await pendingDownload;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    expect(exported.state).toEqual(file.state);
    expect(exported.cast).toEqual(file.cast);
    expect(exported.inputs).toEqual(file.inputs);
    expect(exported.castHeads).toEqual(file.castHeads ?? {});
    expect(exported.castSources).toEqual(file.castSources ?? {});
    expect(exported.rules).toBe(file.rules);
    console.log(`FOREIGN_PUBLIC_EXPORT_PEOPLE=${exported.state.people.length}`);
    if (process.env.VALLEY_PUBLIC_PROOF_DIR)
      writeFileSync(
        `${process.env.VALLEY_PUBLIC_PROOF_DIR}/actual-public-export.json`,
        JSON.stringify(exported),
      );
    await page.getByRole('button', { name: 'Open another Valley file', exact: true }).click();
    await expect.poll(() => page.getByLabel('Open a Valley file').count()).toBe(1);
    await page
      .getByLabel('Open a Valley file')
      .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await expect.poll(() => page.locator('#foreign-result').textContent()).toContain('full Valley file');
    await page.getByLabel('Open a Valley file').setInputFiles({
      name: 'unknown.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...file, unknownNativeField: true })),
    });
    await expect.poll(() => page.locator('#foreign-result').textContent()).toContain('unsupported fields');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('button', { name: 'Open another Valley file', exact: true }).click();
    await expect.poll(() => page.getByLabel('Open a Valley file').count()).toBe(1);
    await page.getByLabel('Open a Valley file').setInputFiles({
      name: 'reimport.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(exported)),
    });
    await expect.poll(() => page.locator('#map').count()).toBe(1);
    const primary = page.locator('#thumbs button.primary');
    console.log(`FOREIGN_ORDINARY_CONTROL=${await primary.textContent()}`);
    await primary.click();
    await page.clock.runFor(1000);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const afterDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download this Valley file', exact: true }).click();
    const afterStream = await (await afterDownload).createReadStream();
    const afterChunks: Buffer[] = [];
    for await (const chunk of afterStream) afterChunks.push(Buffer.from(chunk));
    const afterInput = JSON.parse(Buffer.concat(afterChunks).toString('utf8'));
    expect(afterInput.inputs.length).toBeGreaterThan(exported.inputs.length);
    expect(afterInput.state.people).toHaveLength(exported.state.people.length);
    expect(afterInput.state.kahya).toBeDefined();
    if (process.env.VALLEY_PUBLIC_PROOF_DIR)
      writeFileSync(
        `${process.env.VALLEY_PUBLIC_PROOF_DIR}/actual-after-input-export.json`,
        JSON.stringify(afterInput),
      );
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('button', { name: 'Close file session', exact: true }).click();
    expect(await page.getByLabel('Open a Valley file').count()).toBe(1);
    expect(
      await page.evaluate(() => {
        const t = window as unknown as { nativeReads: number; nativeWrites: number; swRegistrations: number };
        return {
          reads: t.nativeReads,
          writes: t.nativeWrites,
          registrations: t.swRegistrations,
          consent: localStorage.getItem('hf-persona-opt-in'),
          shelfFrames: [...document.querySelectorAll('iframe')].filter(
            (f) => f.title === 'Fictional person shelf',
          ).length,
        };
      }),
    ).toEqual({ reads: 0, writes: 0, registrations: 0, consent: '0', shelfFrames: 0 });
    const owner = await page.evaluate(async () => {
      const log = localStorage.getItem('valley-log-v1');
      const rows = await new Promise<{ key: string; owner: boolean; text: string }[]>((resolve, reject) => {
        const request = indexedDB.open('valley');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('volumes');
          const values = tx.objectStore('volumes').getAll();
          const keys = tx.objectStore('volumes').getAllKeys();
          tx.oncomplete = async () => {
            const result = await Promise.all(
              values.result.map(async (row, index) => ({
                key: String(keys.result[index]),
                owner: row.owner,
                text: await row.gz.text(),
              })),
            );
            db.close();
            resolve(result);
          };
        };
      });
      return { log, rows };
    });
    expect(owner).toEqual({
      log: 'occupied-owner-log',
      rows: [
        { key: 'current', owner: true, text: 'owner-current' },
        { key: 'history:owner', owner: true, text: 'owner-history' },
      ],
    });
    if (process.env.VALLEY_PUBLIC_PROOF_DIR)
      writeFileSync(
        `${process.env.VALLEY_PUBLIC_PROOF_DIR}/owner-native-sentinel-readback.json`,
        JSON.stringify(owner),
      );
  } finally {
    preserveForeignBrowser = true;
    const pending = await page.evaluate(async () => {
      const names = await indexedDB.databases();
      if (!names.some((db) => db.name === 'hf-lab-pending')) return 0;
      return new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('hf-lab-pending');
        request.onsuccess = () => {
          const db = request.result;
          const count = db.transaction('pieces').objectStore('pieces').count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
          count.onerror = () => reject(count.error);
        };
        request.onerror = () => reject(request.error);
      });
    });
    expect(pending, 'Localhost SDK pending pieces must be zero before cleanup').toBe(0);
    console.log(`FOREIGN_SOURCE_PENDING_AT_CLOSE=${pending}`);
    if (process.env.VALLEY_PUBLIC_PROOF_DIR)
      writeFileSync(
        `${process.env.VALLEY_PUBLIC_PROOF_DIR}/pending-at-close.json`,
        JSON.stringify({
          observed: pending,
          observedAt: new Date().toISOString(),
          localhost: true,
          APIinterception: false,
        }),
      );
    preserveForeignBrowser = false;
    await page.close();
  }
});

async function paceReason(page: Page): Promise<string> {
  const info = page.getByRole('button', { name: 'Current pace reason', exact: true });
  await info.click();
  const words = await visibleText(page.locator('#pace-explanation'));
  await info.click();
  return words;
}

// Scope: public notebook presentation only; real inputs and engine-produced answers, no actor/clock mutation.
it('keeps the public phone notebook readable and exposes Say, its dated response and actual pace reason', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(
      page,
      1110,
      7,
      [
        { at: 420, verb: 'call', job: 'reap-agha', houses: ['coban'] },
        { at: 1080, verb: 'visit', house: 'coban' },
      ],
      true,
      'valley-public-2026-10',
    );
    await page.evaluate(() => document.fonts.ready);
    const geometry = await page
      .locator('#sheet')
      .evaluate((e) => ({ height: e.clientHeight, rect: e.getBoundingClientRect().toJSON() }));
    console.log('NOTEBOOK_BASE_GEOMETRY', JSON.stringify(geometry));
    expect(geometry.height).toBeGreaterThanOrEqual(200);
    await page.getByRole('button', { name: /^Ask Zehra about her words/ }).click();
    await page.getByRole('button', { name: 'Not now', exact: true }).click();
    await page.getByRole('button', { name: 'Back to the notebook', exact: true }).click();
    const say = page.getByRole('button', { name: /^Say something at the Çoban house/ });
    await say.click();
    const listen = page.getByRole('button', { name: /^Say: I came to listen/ });
    await listen.click();
    const pending = page.locator('.visit-reply');
    expect(await pending.textContent()).toContain('No answer yet');
    expect(await pending.textContent()).not.toContain('in answer');
    const input = await page.evaluate(
      `import('/src/ui/app.ts').then(({_debug})=>_debug.game().inputs.at(-1))`,
    );
    expect(input).toMatchObject({ verb: 'reply', house: 'coban', saying: 'listen' });
    // Two ordinary sayings can share one game minute. The latest outward answer must stay the latest.
    await page.getByRole('button', { name: /^Say something at the Çoban house/ }).click();
    await page.getByRole('button', { name: /^Say: Finish your own barley first/ }).click();
    const second = await page.evaluate(
      `import('/src/ui/app.ts').then(({_debug})=>_debug.game().inputs.at(-1))`,
    );
    expect(second).toMatchObject({ verb: 'reply', house: 'coban', saying: 'finish', at: 1110 });
    expect(await page.evaluate(() => document.activeElement?.closest('#sheet') !== null)).toBe(true);
    await page.clock.runFor(6000);
    const engine = await page.evaluate<{ minute: number; words: string }>(
      `import('/src/ui/app.ts').then(({_debug})=>{const s=_debug.game().valley;const n=s.notes.findLast(n=>n.house==='coban'&&n.at===${1111}&&n.kind==='voice');return {minute:s.minute,words:n?.words??''}})`,
    );
    expect(engine.minute).toBeGreaterThanOrEqual(1111);
    expect(engine.words).not.toBe('');
    expect(await pending.textContent()).toContain(engine.words);
    expect(await pending.textContent()).not.toContain('No answer yet');
    const box = await pending.boundingBox();
    const thumbs = await page.locator('#thumbs').boundingBox();
    expect(box && thumbs && box.y >= geometry.rect.top && box.y + box.height <= thumbs.y).toBe(true);
    const pace = await paceReason(page);
    expect(pace).not.toContain('Return to the notebook');
    await page.locator('[data-h="coban"]').click();
    expect(await paceReason(page)).toContain('house');
    await page.getByRole('button', { name: 'Back to the notebook', exact: true }).click();
    expect(await paceReason(page)).not.toContain('Return to the notebook');
  } finally {
    await page.close();
  }
});

it('shows an engine-produced Zehra pending question in the public notebook without promising an answer', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(
      page,
      1110,
      7,
      [
        { at: 420, verb: 'call', job: 'reap-agha', houses: ['coban'] },
        { at: 1080, verb: 'visit', house: 'coban' },
      ],
      true,
      'valley-public-2026-10',
    );
    await page.locator('[data-h="coban"]').click();
    await page.getByRole('button', { name: /^You said, “Who will feed my family/ }).click();
    const exchange = await page.evaluate<{ status: string; answerNote?: number }>(
      `import('/src/ui/app.ts').then(({_debug})=>_debug.game().valley.dialogue.exchanges.at(-1))`,
    );
    expect(exchange.status).toBe('pending');
    expect(exchange.answerNote).toBeUndefined();
    await page.getByRole('button', { name: 'Back to the notebook', exact: true }).click();
    expect(await page.locator('#sheet').textContent()).toContain(
      'Your question is waiting to reach Zehra. No answer yet.',
    );
    expect(await page.locator('#sheet').textContent()).not.toContain('The talk finished.');
  } finally {
    await page.close();
  }
});

it('explains temporary new-news slowdown in the notebook and keeps menu pause', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await open(page, 420, 7, [], true, 'valley-public-2026-10');
    await page.getByRole('button', { name: /^Call the hamlet to cut/ }).click();
    await page.clock.runFor(1500);
    const info = page.getByRole('button', { name: 'Current pace reason', exact: true });
    expect(await info.count()).toBe(1);
    expect(await page.locator('[data-pace-menu] + [data-pace-info]').count()).toBe(1);
    expect(await page.locator('#pace-explanation').isVisible()).toBe(false);
    const beforeInfo = await state(page);
    expect(await paceReason(page)).toContain('New replies or news');
    expect(await state(page)).toEqual(beforeInfo);
    await info.click();
    // The existing UI advances in 30-minute quanta; reading runs at two minutes per second.
    await page.clock.runFor(16000);
    expect((await state(page)).minute).toBeGreaterThan(beforeInfo.minute);
    await info.press('Escape');
    expect(await page.locator('#pace-explanation').isVisible()).toBe(false);
    expect(await paceReason(page)).toContain('New replies or news');
    expect(await paceReason(page)).not.toContain('Back returns');
    const sheet = await page.locator('#sheet').boundingBox();
    expect(sheet?.height).toBeGreaterThanOrEqual(200);
    await page.getByRole('button', { name: 'The ledger ▸', exact: true }).click();
    expect(await paceReason(page)).toContain('ledger is open');
    await page.getByRole('button', { name: 'Back to the notebook', exact: true }).click();
    await page.getByRole('button', { name: 'Time control', exact: true }).click();
    const paused = await state(page);
    await page.clock.runFor(2000);
    expect(await state(page)).toEqual(paused);
    await page.locator('[data-close-menu]').click();
    await page.getByRole('button', { name: 'Skip to the next event', exact: true }).click();
    expect(await paceReason(page)).toContain('Skipping');
    expect(await paceReason(page)).not.toContain('Back returns');
  } finally {
    await page.close();
  }
});

it('keeps the actual Zehra gate and household identity through a cancelled question and late gift callback', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await page.route('**/api/**', (route) => route.abort());
    await open(
      page,
      1110,
      7,
      [
        {
          at: 420,
          verb: 'call',
          job: 'reap-agha',
          houses: newGame(7, undefined, false, true, 'valley-public-2026-10')
            .valley.households.filter((h) => h.hamlet === 'lower')
            .map((h) => h.id),
        },
        { at: 1080, verb: 'visit', house: 'coban' },
      ],
      true,
      'valley-public-2026-10',
    );
    expect(await page.locator('.reply-count').textContent()).toContain('have not answered');
    await page.locator('[data-h="coban"]').click();
    expect(await page.locator('.scene-context').textContent()).toContain('Who will feed my family');
    expect(await page.locator('.scene-context').textContent()).toContain('She may choose not to answer');
    expect(await page.getByRole('button', { name: /^Let the Çoban house finish first/ }).count()).toBe(1);
    const question = page.getByRole('button', { name: /^You said, “Who will feed my family/ });
    await question.click();
    await page.getByRole('button', { name: 'End this question', exact: true }).click();
    await page.getByRole('button', { name: 'Send grain', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm send grain', exact: true }).click();
    const gameTape = () =>
      page.evaluate(
        `Promise.all([import('/src/ui/app.ts'), import('/src/sim/game.ts')]).then(([{_debug},{save}])=>{const {savedAt,...run}=save(_debug.game());return run;})`,
      );
    const earned = await gameTape();
    await page.getByRole('button', { name: 'Send grain', exact: true }).click();
    // Retain the actual old DOM callback, then cancel the pending command and invoke it late.
    await page.getByRole('button', { name: 'Confirm send grain', exact: true }).evaluate((b) => {
      (window as unknown as { staleConfirm: HTMLElement }).staleConfirm = b as HTMLElement;
    });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => (window as unknown as { staleConfirm: HTMLElement }).staleConfirm.click());
    expect(await gameTape()).toEqual(earned);
    expect(await page.locator('#action-receipt').textContent()).toContain('No additional grain was sent');
    await page.clock.runFor(20000);
    const after = await page.evaluate<{ exchange: { status: string; answerNote?: number }; gifts: Input[] }>(
      `import('/src/ui/app.ts').then(({_debug})=>({exchange:_debug.game().valley.dialogue.exchanges[0],gifts:_debug.game().inputs.filter(i=>i.verb==='give')}))`,
    );
    expect(after.exchange.status).toBe('cancelled');
    expect(after.exchange.answerNote).toBeUndefined();
    expect(after.gifts).toHaveLength(1);
    expect(await page.locator('.scene-context').textContent()).toMatch(
      /asleep|not at this house|left the house|may choose not to answer/,
    );
    await page.evaluate(`import('/src/ui/app.ts').then(({_debug})=>_debug.skipTo(10))`);
    await page.getByRole('button', { name: 'Back to the notebook', exact: true }).click();
    expect(await page.locator('.after-cut-context').textContent()).toContain('This is an earlier reply');
    await page.getByRole('button', { name: /^Read Zehra’s visit at the Çoban house/ }).click();
    expect(await page.locator('.scene-context').textContent()).toContain('Visit this house');
    await page.getByRole('button', { name: 'Visit', exact: true }).click();
    expect(await page.locator('.scene-context').textContent()).toContain('still walking');
    await page.evaluate(`import('/src/ui/app.ts').then(({_debug})=>_debug.skipTo(10 + 30 / 1440))`);
    expect(await page.locator('.scene-context').textContent()).toContain('asleep');
    const final = await state(page);
    await page.reload();
    expect(await page.locator('.title-actions').textContent()).toContain('Your saved place is kept');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('valley-log-v1') ?? '{}').minute)).toBe(
      final.minute,
    );
  } finally {
    await page.close();
  }
});

it.each([
  [360, 690],
  [1280, 800],
])('answers the explicit completed-cut follow-up in the real App at %ix%i', async (width, height) => {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(4000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Synthetic file session: real SDK and host, no owner storage or external traffic.
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  const game = newGame(7, undefined, false, true, 'valley-public-2026-10');
  const { act } = await import('../src/sim/game.ts');
  expect(
    act(game, {
      verb: 'call',
      job: 'reap-agha',
      houses: game.valley.households.filter((h) => h.hamlet === 'lower').map((h) => h.id),
    }),
  ).toBe(true);
  step(game, 6210);
  // Native public visit acknowledges the actual invitation and reaches this attended scene.
  expect(act(game, { verb: 'visit', house: 'coban' })).toBe(true);
  step(game, 6240);
  const opening = save(game);
  const chooseFile = async (packet: unknown) => {
    await page.getByLabel('Open a Valley file').setInputFiles({
      name: 'synthetic-valley.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(packet)),
    });
  };
  const downloadFile = async () => {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download this Valley file', exact: true }).click();
    const chunks: Buffer[] = [];
    for await (const chunk of await (await pending).createReadStream()) chunks.push(Buffer.from(chunk));
    const packet = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    return packet;
  };
  try {
    await page.clock.install();
    await page.goto(`${origin}/file/`);
    await page.clock.pauseAt(Date.now() + 50);
    await chooseFile(opening);
    // Loading validates the full saved history by replaying it before rendering.
    await expect.poll(() => page.locator('#map').count(), { timeout: 30000 }).toBe(1);
    await page.locator('[data-h="coban"]').click();
    const follow = page.getByRole('button', { name: /^The landowner’s barley is cut now/ });
    expect(await follow.count()).toBe(1);
    await follow.click();
    expect(await page.locator('.cut-follow-up').textContent()).toContain('completion time was not recorded');
    expect(await page.locator('.cut-follow-up').textContent()).toContain('Who will feed my family');
    expect(await page.locator('.dialogue').textContent()).toContain('No answer yet');
    await page.evaluate(`import('/src/ui/app.ts').then(({_debug})=>_debug.skipTo(6330 / 1440))`);
    expect(await page.locator('.dialogue').textContent()).toContain('The talk finished.');
    expect(await page.locator('.cut-follow-up').textContent()).toContain(
      'Finishing his field does not answer that question.',
    );
    expect(await page.locator('.cut-follow-up').textContent()).toContain('18 July');
    expect(await page.locator('.cut-follow-up').textContent()).toContain('22 July');
    await fits(page);
    const completed = await downloadFile();
    const { load } = await import('../src/sim/game.ts');
    const {
      savedAt: _at,
      castHeads: _heads,
      castSources: _sources,
      label: _volumeLabel,
      ...wire
    } = completed;
    // App volume labels follow the existing binder count; load returns the game, not that count.
    const {
      savedAt: _restoredAt,
      label: _defaultVolumeLabel,
      ...restored
    } = JSON.parse(JSON.stringify(save(load(completed))));
    expect(restored).toEqual(wire);
    if (process.env.VALLEY_PUBLIC_PROOF_DIR)
      writeFileSync(
        `${process.env.VALLEY_PUBLIC_PROOF_DIR}/after-cut-ui-${width}.json`,
        JSON.stringify(completed),
      );
    // Whole-state replay refuses a changed historical anchor, preserving the held packet.
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('button', { name: 'Open another Valley file', exact: true }).click();
    const forged = structuredClone(completed);
    forged.state.dialogue.exchanges[0].cut.reaped += 1;
    await chooseFile(forged);
    await expect
      .poll(() => page.locator('#foreign-result').textContent({ timeout: 30000 }), { timeout: 30000 })
      .toContain('dialogue replay');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    const held = await downloadFile();
    const { savedAt: _heldAt, label: _heldVolumeLabel, ...heldRest } = held;
    const { savedAt: _originalAt, label: _originalVolumeLabel, ...originalRest } = completed;
    // Existing menu saves advance the volume label; every run/source/history value stays literal.
    expect(held.label).toMatch(/^Volume /);
    expect(heldRest).toEqual(originalRest);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('button', { name: 'Open another Valley file', exact: true }).click();
    await chooseFile(completed);
    await expect.poll(() => page.locator('#map').count(), { timeout: 30000 }).toBe(1);
    await page.evaluate(`import('/src/ui/app.ts').then(({_debug})=>_debug.skipTo(7770 / 1440))`);
    const continued = await downloadFile();
    const reference = load(completed);
    step(reference, continued.minute);
    expect(continued.state).toEqual(JSON.parse(JSON.stringify(save(reference).state)));
    expect(continued.inputs).toEqual(completed.inputs);
    // One later ordinary visit must retain the old source without claiming a new request.
    await page.evaluate(`import('/src/ui/app.ts').then(({_debug})=>{
      _debug.order({verb:'visit',house:'coban'});
      _debug.skipTo(7800 / 1440);
    })`);
    if ((await page.locator('[data-h="coban"]').getAttribute('aria-pressed')) !== 'true')
      await page.locator('[data-h="coban"]').click();
    const laterText = await visibleText(page.locator('.dialogue'));
    expect(laterText).toContain('Earlier question: The talk finished.');
    expect(laterText).toContain('Question recorded 22 July, year one');
    expect(laterText).toContain('18 July, year one');
    expect(laterText).toContain('completion time was not recorded');
    expect(laterText).toContain('Finishing his field does not answer that question.');
    expect(laterText).not.toContain('during this visit');
    const later = await page.evaluate<{ requestAt: number; requestVisit: number; currentVisit: number }>(
      `import('/src/ui/app.ts').then(({_debug})=>{const s=_debug.game().valley;return {requestAt:s.dialogue.exchanges[0].saidAt,requestVisit:s.dialogue.exchanges[0].visit,currentVisit:s.kahyaState.visit.arrive}})`,
    );
    expect(later).toEqual({ requestAt: 6240, requestVisit: 6230, currentVisit: 7790 });
    await fits(page);
    if (process.env.VALLEY_PUBLIC_PROOF_DIR)
      writeFileSync(
        `${process.env.VALLEY_PUBLIC_PROOF_DIR}/later-visit-ui-${width}.json`,
        JSON.stringify({ later, laterText }),
      );
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});
