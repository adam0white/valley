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

async function fixture(page: Page, mode: 'linked' | 'off' | 'dnt' | 'title' | 'unverified' = 'linked') {
  page.setDefaultTimeout(4000);
  await page.route('https://human.adamwhite.work/**', (route) => route.fulfill({ status: 204, body: '' }));
  if (mode === 'dnt')
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'doNotTrack', { get: () => '1', configurable: true }),
    );
  await page.route('**/src/main.ts', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: "import '/src/ui/style.css'; import '/node_modules/@adam0white/lab-kit/stage.css';",
    }),
  );
  await page.goto(origin);
  await page.evaluate(`(async (mode) => {
    const { save, newGame, load, fingerprint } = await import('/src/sim/game.ts');
    const { mountLab, lab, labScreen } = await import('/src/ui/lab.ts');
    lab.setTelemetryOff(mode === 'off');
    lab.setPersonaRecording(mode === 'unverified' ? 'unverified-fixture' : null); // Synthetic genuinely fresh component fixture.
    const run = save(newGame(7));
    document.body.innerHTML = '<header class="topbar"><button type="button" data-menu>Menu</button></header>';
    const target = window;
    target.feedbackCalls = []; target.runCalls = []; target.downloadCount = 0; target.recordingChoices = [];
    target.titleCount = 0; target.notebookCount = 0; target.bindCount = 0;
    target.replayFingerprint = (value) => fingerprint(load(value).valley);
    lab.sendFeedback = async (...args) => { target.feedbackCalls.push(args); return 'feedback-test'; };
    lab.sendRun = async (...args) => { target.runCalls.push(args); return 'run-test'; };
    mountLab({ chooseRecording: async allow => { target.recordingChoices.push(allow); await new Promise(() => {}); }, getRun: () => mode === 'title' ? undefined : run, hasRun: () => mode !== 'title',
      download: () => { target.downloadCount++; target.downloadedRun = run; },
      bindVolume: async () => { target.bindCount++; },
      notebook: () => { target.notebookCount++; },
      toTitle: () => { target.titleCount++; },
      getSpeed: () => target.speed ?? 'automatic', setSpeed: value => { target.speed = value; },
      date: () => '18 July, year one' });
    labScreen(mode === 'title' ? 'title' : 'play');
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
    await page.setViewportSize({ width: 1280, height: 800 });
    const drawer = await menu.boundingBox();
    expect((drawer?.y ?? 0) + (drawer?.height ?? 0)).toBeCloseTo(800, 0);
    const resume = await menu.locator('[data-resume]').boundingBox();
    expect((resume?.y ?? 0) + (resume?.height ?? 0)).toBeGreaterThanOrEqual(660);
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
    expect(await panel.innerText()).toContain('Send a note about this game.');
    await panel.locator('summary').click();
    const privacy = await panel.locator('details a').boundingBox();
    expect(privacy?.height).toBeGreaterThanOrEqual(44);
    await panel.locator('summary').click();
    const note = panel.locator('textarea').first();
    await note.fill('The winter felt slow.');
    await panel.getByLabel('Your name or tester id', { exact: false }).fill('River tester');
    expect(await panel.innerText()).toMatch(/name.*(player|history)|history.*name/is);
    await panel.getByRole('button', { name: 'Keep a copy of this run', exact: true }).click();
    expect(await page.evaluate('window.downloadCount')).toBe(1);
    expect(await page.evaluate('!!window.downloadedRun.state && !!window.downloadedRun.savedAt')).toBe(true);
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => panel.innerText()).toContain('queued');
    const sent = await counts(page);
    expect(sent.feedback).toHaveLength(1);
    expect(sent.feedback[0]?.[0]).toContain('The winter felt slow.');
    expect(sent.feedback[0]?.[1]).toEqual(
      expect.objectContaining({ name: 'River tester', run: expect.any(Object) }),
    );
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

it('allows notes while recording is off and keeps download', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await fixture(page, 'off');
    await sendWord(page);
    const panel = feedback(page);
    const send = panel.getByRole('button', { name: 'Send', exact: true });
    expect(await send.isDisabled()).toBe(false);
    await panel.getByRole('button', { name: 'Keep a copy of this run', exact: true }).click();
    expect(await page.evaluate('window.downloadCount')).toBe(1);
    expect(await counts(page)).toEqual({ feedback: [], runs: [] });
    expect(await panel.getByRole('checkbox', { name: 'Record play for the lab', exact: true }).count()).toBe(
      0,
    );
    await expect.poll(() => send.isEnabled()).toBe(true);
    await send.click();
    await expect.poll(async () => (await counts(page)).feedback.length).toBe(1);
  } finally {
    await page.close();
  }
});

it('sends a privacy-signal note on the same page without a run-consent step', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await fixture(page, 'dnt');
    await sendWord(page);
    const panel = feedback(page);
    expect(
      await panel.getByRole('checkbox', { name: 'Send this run with my note', exact: true }).count(),
    ).toBe(0);
    await panel.locator('textarea').first().fill('I wanted to visit another house.');
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(async () => (await counts(page)).feedback.length).toBe(1);
    expect((await counts(page)).runs).toHaveLength(0);
    await expect.poll(() => panel.innerText()).toContain('queued');
  } finally {
    await page.close();
  }
});

it('offers Send word before starting a run', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await fixture(page, 'title');
    await sendWord(page);
    await feedback(page).locator('textarea').first().fill('A note from the title page.');
    await feedback(page).getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(async () => (await counts(page)).feedback.length).toBe(1);
    expect((await counts(page)).runs).toHaveLength(0);
  } finally {
    await page.close();
  }
});

it('uses the supplied complete-history choice while pending without granting linkage or blocking notes', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await fixture(page, 'unverified');
    await sendWord(page);
    const panel = feedback(page);
    await panel.getByRole('checkbox', { name: /Link all continuing histories/ }).click();
    await expect.poll(() => page.evaluate('window.recordingChoices')).toEqual([true]);
    expect(
      await page.evaluate(`(async () => (await import('/src/ui/lab.ts')).lab.personaRecordingAllowed)()`),
    ).toBe(false);
    await panel.locator('textarea').fill('The pending choice does not block my note.');
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(async () => (await counts(page)).feedback.length).toBe(1);
  } finally {
    await page.close();
  }
});
