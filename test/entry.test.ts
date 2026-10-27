import type { ChildProcess } from 'node:child_process';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startBrowserServer } from './browser-server.ts';

let server: ChildProcess;
let browser: Browser;
let origin: string;
beforeAll(async () => {
  ({ server, origin } = await startBrowserServer('entry-test'));
  browser = await chromium.launch();
}, 30000);
afterAll(async () => {
  server?.kill('SIGTERM');
  await browser?.close();
});
async function page() {
  const context = await browser.newContext();
  const tab = await context.newPage();
  // Observe the real Shelf constructor call without replacing its implementation.
  await tab.route('**/src/ui/cast-session.ts', async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    expect(source).toContain('personaChannel()');
    await route.fulfill({
      response,
      body: source.replace(
        'personaChannel()',
        "(window.entrySinks.push('personaChannel'), personaChannel())",
      ),
    });
  });
  tab.setDefaultTimeout(5000);
  await tab.route('https://human.adamwhite.work/**', (route) => route.fulfill({ status: 204, body: '' }));
  await tab.addInitScript(() => {
    const target = window as unknown as { entrySinks: string[] };
    target.entrySinks = [];
    // Synthetic profile only. Seed before observing startup sinks.
    localStorage.setItem('hf-lab-player', 'a'.repeat(32));
    sessionStorage.setItem('hf-lab-session:valley', `${'b'.repeat(32)}:${Date.now()}`);
    sessionStorage.setItem('hf-lab-run:valley', 'c'.repeat(32));
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (this: Storage, key: string, ...rest: string[]) {
        if (key.startsWith('valley-') || key.startsWith('hf-lab')) target.entrySinks.push(`${method}:${key}`);
        return Reflect.apply(original, this, [key, ...rest]);
      };
    }
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...args: Parameters<typeof open>) => {
      target.entrySinks.push(`db:${args[0]}`);
      return open(...args);
    };
    if ('serviceWorker' in navigator)
      navigator.serviceWorker.register = async () => {
        target.entrySinks.push('serviceWorker.register');
        return {} as ServiceWorkerRegistration;
      };
  });
  return { tab, context };
}
const sinks = (tab: Page) => tab.evaluate<string[]>('window.entrySinks');
const status = (tab: Page) =>
  tab.evaluate(`import('/src/ui/lab.ts').then(({lab}) => lab.preservationStatus)`);

it('actual canonical entry selects published preserving SDK and no native ledger/Shelf/SW startup', async () => {
  const { tab, context } = await page();
  try {
    await tab.goto(`${origin}/file/`);
    await tab.getByLabel('Open a Valley file', { exact: true }).waitFor();
    expect(await status(tab)).toBe('existing-local');
    expect(
      (await sinks(tab)).filter(
        (x) =>
          x.includes('valley-log') ||
          (x.startsWith('db:') && x !== 'db:hf-lab-pending') ||
          x.startsWith('serviceWorker'),
      ),
    ).toEqual([]);
    expect(await tab.locator('iframe').count()).toBe(0);
    expect(await sinks(tab)).not.toContain('personaChannel');
    expect(await tab.locator('[data-new]').isDisabled()).toBe(true);
  } finally {
    await context.close();
  }
});
it('actual legacy entry redirects before App/SDK/native startup and keeps unrelated attribution', async () => {
  const { tab, context } = await page();
  const modules: string[] = [];
  tab.on('request', (request) => {
    if (/\/src\/ui\/(app|lab)\.ts/.test(request.url())) modules.push(request.url());
  });
  // Stop at the real redirect destination, before its own independent startup.
  await tab.route(`${origin}/file/**`, (route) =>
    route.request().isNavigationRequest()
      ? route.fulfill({ status: 200, contentType: 'text/html', body: '<p>redirect destination</p>' })
      : route.continue(),
  );
  try {
    await tab.goto(`${origin}/?file=1&labRunSource=agent&other=keep#section`);
    await tab.waitForURL(`${origin}/file/?labRunSource=agent&other=keep#section`);
    expect(modules).toEqual([]);
    expect(await sinks(tab)).toEqual([]);
  } finally {
    await context.close();
  }
});
it('actual malformed and duplicate legacy entries refuse before App/SDK/native startup', async () => {
  for (const path of ['/?file=0', '/?file=', '/?file=1&file=1', '/file/?file=1&file=other']) {
    const { tab, context } = await page();
    const modules: string[] = [];
    tab.on('request', (request) => {
      if (/\/src\/ui\/(app|lab)\.ts/.test(request.url())) modules.push(request.url());
    });
    try {
      await tab.goto(origin + path);
      await tab.getByText('This file address is invalid. Use /file/ to choose a saved file.').waitFor();
      expect(modules).toEqual([]);
      expect(await sinks(tab)).toEqual([]);
    } finally {
      await context.close();
    }
  }
});
it('actual ordinary startup retains standard SDK and native ledger/Shelf/SW path', async () => {
  const { tab, context } = await page();
  try {
    await tab.goto(origin);
    await tab.locator('.title-premise').waitFor();
    expect(await status(tab)).toBe('standard');
    const calls = await sinks(tab);
    expect(calls).toContain('getItem:valley-log-v1');
    expect(calls).toContain('personaChannel');
    expect(calls).toContain('serviceWorker.register');
    expect(await tab.getByLabel('Open a Valley file', { exact: true }).count()).toBe(0);
  } finally {
    await context.close();
  }
});
