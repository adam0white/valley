import type { ChildProcess } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startBrowserServer } from './browser-server.ts';

let server: ChildProcess;
let browser: Browser;
let origin: string;
const compactNote = 'Long runs send a shorter replay: the seed and every input, without the full state.';
beforeAll(async () => {
  ({ server, origin } = await startBrowserServer('lab-ui-test'));
  browser = await chromium.launch();
}, 30000);
afterAll(async () => {
  server?.kill('SIGTERM');
  await browser?.close();
}, 30000);

async function fixture(page: Page, oversized: boolean) {
  await page.goto(origin);
  await page.evaluate(`(async (oversized) => {
    const gamePath = '/src/sim/game.ts';
    const labPath = '/src/ui/lab.ts';
    const { save, newGame, load, fingerprint } = await import(gamePath);
    const { mountLab, lab } = await import(labPath);
    lab.setEventsOff(false);
    const run = save(newGame(7));
    if (oversized) run.padding = 'x'.repeat(4 * 1024 * 1024 + 1);
    document.querySelector('#lab-controls')?.remove();
    const target = window;
    target.replayFingerprint = (run) => fingerprint(load(run).valley);
    mountLab({ getRun: () => run, hasRun: () => true, download: () => { target.downloadedRun = run; }, bindVolume: async () => {} });
  })(${oversized})`);
  await page.getByText('Game menu', { exact: true }).click();
}

it('discloses compact replay before consent, keeps full download, and retries an offline send with its note', async () => {
  const page = await browser.newPage();
  const sent: unknown[] = [];
  let attempts = 0;
  await page.route('https://human.adamwhite.work/**', async (route) => {
    if (route.request().method() === 'POST' && route.request().url().endsWith('/run')) {
      const bytes = route.request().postDataBuffer();
      if (!bytes) throw new Error('Missing compressed run');
      sent.push(JSON.parse(gunzipSync(bytes).toString()));
      attempts++;
      if (attempts === 1) return route.abort('internetdisconnected');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'r-test' }),
      });
    }
    await route.fulfill({ status: 204, body: '' });
  });
  try {
    await fixture(page, true);
    await page.getByRole('button', { name: 'Download this run', exact: true }).click();
    expect(
      await page.evaluate(() => {
        const run = (
          window as typeof window & {
            downloadedRun: { state?: unknown; savedAt?: unknown; padding?: string };
          }
        ).downloadedRun;
        return !!run.state && !!run.savedAt && (run.padding?.length ?? 0) > 4 * 1024 * 1024;
      }),
    ).toBe(true);
    await page.getByText('Game menu', { exact: true }).click();
    await page.getByRole('button', { name: 'Send this run to the notebook', exact: true }).click();
    await page.getByText(compactNote, { exact: true }).waitFor({ state: 'visible' });
    const send = page.getByRole('button', { name: 'Send', exact: true });
    await expect.poll(() => send.isEnabled()).toBe(true);
    const preview = page.locator('.hflab textarea.exact');
    const envelope = JSON.parse(await preview.inputValue());
    expect(envelope.compacted).toBe(true);
    expect(envelope.run).not.toHaveProperty('state');
    expect(envelope.run).not.toHaveProperty('savedAt');
    expect(envelope.run).not.toHaveProperty('padding');
    expect(
      await page.evaluate(
        (run) =>
          (window as typeof window & { replayFingerprint: (run: unknown) => string }).replayFingerprint(run),
        envelope.run,
      ),
    ).toBe(envelope.run.fingerprint);
    await page.locator('#hflab-note').fill('The map was clear; the winter felt slow.');
    await expect
      .poll(async () => JSON.parse(await preview.inputValue()).note)
      .toBe('The map was clear; the winter felt slow.');
    await expect.poll(() => send.isEnabled()).toBe(true);
    await send.click();
    await expect.poll(() => page.locator('.hflab .status').innerText()).toMatch(/^Not sent:/);
    expect(await page.locator('#hflab-note').inputValue()).toBe('The map was clear; the winter felt slow.');
    await send.click();
    await expect.poll(() => page.locator('.hflab .status').innerText()).toContain('Reference r-test');
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(sent[1]);
    expect(sent[1]).toMatchObject({ compacted: true, note: 'The map was clear; the winter felt slow.' });
  } finally {
    await page.close();
  }
});

it('previews an ordinary full run without a compaction notice', async () => {
  const page = await browser.newPage();
  await page.route('https://human.adamwhite.work/**', (route) => route.fulfill({ status: 204, body: '' }));
  try {
    await fixture(page, false);
    await page.getByRole('button', { name: 'Send this run to the notebook', exact: true }).click();
    await expect.poll(() => page.getByRole('button', { name: 'Send', exact: true }).isEnabled()).toBe(true);
    const envelope = JSON.parse(await page.locator('.hflab textarea.exact').inputValue());
    expect(envelope.run).toHaveProperty('state');
    expect(envelope).not.toHaveProperty('compacted');
    expect(await page.getByText(compactNote, { exact: true }).count()).toBe(0);
  } finally {
    await page.close();
  }
});
