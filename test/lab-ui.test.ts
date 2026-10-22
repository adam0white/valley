import type { ChildProcess } from 'node:child_process';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startBrowserServer } from './browser-server.ts';

let server: ChildProcess;
let browser: Browser;
let origin: string;
beforeAll(async () => {
  ({ server, origin } = await startBrowserServer('lab-ui-test'));
  browser = await chromium.launch();
}, 30000);
afterAll(async () => {
  server?.kill('SIGTERM');
  await browser?.close();
}, 30000);

async function fixture(page: Page, mode: 'linked' | 'off' | 'dnt' = 'linked') {
  page.setDefaultTimeout(4000);
  await page.route('https://human.adamwhite.work/**', (route) => route.fulfill({ status: 204, body: '' }));
  if (mode === 'dnt')
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'doNotTrack', { get: () => '1', configurable: true }),
    );
  await page.goto(origin);
  await page.evaluate(`(async (mode) => {
    const { save, newGame, load, fingerprint } = await import('/src/sim/game.ts');
    const { mountLab, lab, labScreen } = await import('/src/ui/lab.ts');
    lab.setTelemetryOff(mode === 'off');
    const run = save(newGame(7));
    document.body.innerHTML = '<header class="topbar"><button type="button" data-menu>Menu</button></header>';
    const target = window;
    target.feedbackCalls = []; target.runCalls = []; target.downloadCount = 0;
    target.titleCount = 0; target.notebookCount = 0; target.bindCount = 0;
    target.replayFingerprint = (value) => fingerprint(load(value).valley);
    lab.sendFeedback = async (...args) => { target.feedbackCalls.push(args); return 'feedback-test'; };
    lab.sendRun = async (...args) => { target.runCalls.push(args); return 'run-test'; };
    mountLab({ getRun: () => run, hasRun: () => true,
      download: () => { target.downloadCount++; target.downloadedRun = run; },
      bindVolume: async () => { target.bindCount++; },
      notebook: () => { target.notebookCount++; },
      toTitle: () => { target.titleCount++; },
      getSpeed: () => target.speed ?? 'automatic', setSpeed: value => { target.speed = value; },
      date: () => '18 July, year one' });
    labScreen('play');
  })(${JSON.stringify(mode)})`);
  await page.locator('[data-menu]').click();
}
const feedback = (page: Page) => page.locator('.feedback-panel');
async function sendWord(page: Page) {
  await page
    .locator('.game-menu-panel')
    .getByRole('button', { name: /Send word/ })
    .click();
}
async function counts(page: Page) {
  return page.evaluate<{ feedback: unknown[][]; runs: [Record<string, unknown>, Record<string, unknown>][] }>(
    `({ feedback: window.feedbackCalls, runs: window.runCalls })`,
  );
}
async function fits(page: Page) {
  expect(
    await page.evaluate(() => (document.scrollingElement?.scrollHeight ?? Infinity) <= innerHeight + 1),
  ).toBe(true);
  const panel = await feedback(page).boundingBox();
  expect(panel && panel.y >= 0 && panel.y + panel.height <= 691).toBe(true);
}

it('keeps reading, pace and return controls in the menu and binds before returning to title', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await fixture(page);
    const menu = page.locator('.game-menu-panel');
    expect(await menu.getByRole('button', { name: /The notebook/ }).isVisible()).toBe(true);
    expect(
      await menu
        .getByRole('button', { name: /Bind this volume|Download this run|Send this run to the notebook/ })
        .count(),
    ).toBe(0);
    await menu.getByRole('button', { name: 'Fast', exact: true }).click();
    expect(await page.evaluate('window.speed')).toBe('fast');
    const bound = await page.evaluate<number>('window.bindCount');
    await menu.getByRole('button', { name: 'To the title page', exact: true }).click();
    expect(await page.evaluate('({bind: window.bindCount, title: window.titleCount})')).toEqual({
      bind: bound + 1,
      title: 1,
    });
  } finally {
    await page.close();
  }
});

it('sends linked feedback with an optional remembered name and keeps a full local copy', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await fixture(page);
    await sendWord(page);
    await fits(page);
    const panel = feedback(page);
    expect(await panel.innerText()).toContain('Your run, saves and log reach us on their own.');
    const note = panel.locator('textarea').first();
    await note.fill('The winter felt slow.');
    await panel.getByLabel('Your name or tester id', { exact: false }).fill('River tester');
    expect(await panel.innerText()).toMatch(/name.*(player|history)|history.*name/is);
    await panel.getByRole('button', { name: 'Keep a copy of this run', exact: true }).click();
    expect(await page.evaluate('window.downloadCount')).toBe(1);
    expect(await page.evaluate('!!window.downloadedRun.state && !!window.downloadedRun.savedAt')).toBe(true);
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => panel.innerText()).toContain('Sent. Thank you.');
    const sent = await counts(page);
    expect(sent.feedback).toHaveLength(1);
    expect(sent.feedback[0]?.[0]).toContain('The winter felt slow.');
    expect(sent.feedback[0]?.[1]).toEqual({ name: 'River tester' });
    expect(sent.runs).toHaveLength(0);
    await panel.getByRole('button', { name: 'Back to the game', exact: true }).click();
    await page.locator('[data-menu]').click();
    await sendWord(page);
    expect(await feedback(page).getByLabel('Your name or tester id', { exact: false }).inputValue()).toBe(
      'River tester',
    );
  } finally {
    await page.close();
  }
});

it('blocks every send while recording is off and allows download and explicit re-enable', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await fixture(page, 'off');
    await sendWord(page);
    const panel = feedback(page);
    expect(await panel.innerText()).toContain('Recording is off, so nothing is sent.');
    const send = panel.getByRole('button', { name: 'Send', exact: true });
    expect(await send.isDisabled()).toBe(true);
    await panel.getByRole('button', { name: 'Keep a copy of this run', exact: true }).click();
    expect(await page.evaluate('window.downloadCount')).toBe(1);
    expect(await counts(page)).toEqual({ feedback: [], runs: [] });
    await panel.getByRole('checkbox', { name: 'Record play for the lab', exact: true }).check();
    await expect.poll(() => send.isEnabled()).toBe(true);
    await send.click();
    await expect.poll(async () => (await counts(page)).feedback.length).toBe(1);
  } finally {
    await page.close();
  }
});

it('requires privacy-signal consent and sends a compact replay that restores exactly', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await fixture(page, 'dnt');
    await sendWord(page);
    const panel = feedback(page);
    const send = panel.getByRole('button', { name: 'Send', exact: true });
    expect(await send.isDisabled()).toBe(true);
    const consent = panel.getByRole('checkbox', { name: 'Send this run with my note', exact: true });
    expect(await consent.isChecked()).toBe(false);
    await consent.check();
    await panel.locator('textarea').first().fill('I wanted to visit another house.');
    await send.click();
    await expect.poll(async () => (await counts(page)).runs.length).toBe(1);
    const sent = await counts(page);
    expect(sent.feedback).toHaveLength(0);
    const entry = sent.runs[0];
    if (!entry) throw new Error('Missing privacy-consented run');
    const [run, extra] = entry;
    expect(run).not.toHaveProperty('state');
    expect(run).not.toHaveProperty('savedAt');
    expect(extra.note).toContain('I wanted to visit another house.');
    expect(await page.evaluate(`window.replayFingerprint(${JSON.stringify(run)})`)).toBe(run.fingerprint);
    await expect.poll(() => panel.innerText()).toContain('Sent. Thank you.');
  } finally {
    await page.close();
  }
});
