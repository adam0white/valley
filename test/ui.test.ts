import { type ChildProcess, spawn } from 'node:child_process';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { act, type Input, newGame, step } from '../src/sim/game.ts';
import { underSeal } from '../src/sim/valley.ts';

let server: ChildProcess;
let browser: Browser;
const origin = 'http://127.0.0.1:5197';
beforeAll(async () => {
  server = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5197', '--strictPort'],
    { stdio: 'pipe' },
  );
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('UI test server exited');
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
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
    await page.getByRole('button', { name: /Call the hamlet/ }).click();
    expect(await page.locator('.limits').innerText()).toMatch(/crier|request|call/);
    expect(await page.locator('#now').innerText()).toMatch(/answer|repl|crier|called/i);
  } finally {
    await page.close();
  }
});

it('keeps active replies reachable across midnight and history, and restores visits after returning', async () => {
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
    await page.clock.runFor(12000);
    expect(await page.getByRole('button', { name: /Walk down and sit/ }).isEnabled()).toBe(true);
  } finally {
    await page.close();
  }
});
