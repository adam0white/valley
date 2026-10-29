import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { load, newGame, replay, save, stateJson } from '../src/sim/game.ts';
import { startBrowserServer, visibleText } from './browser-server.ts';

let server: ChildProcess;
let browser: Browser;
let origin: string;
let preserveFileBrowser = false;
beforeAll(async () => {
  ({ server, origin } = await startBrowserServer('lab-ui-test'));
  browser = await chromium.launch();
}, 30000);
afterAll(async () => {
  if (!preserveFileBrowser) {
    server?.kill('SIGTERM');
    await browser?.close();
  }
}, 30000);

async function fixture(
  page: Page,
  mode: 'linked' | 'off' | 'dnt' | 'title' | 'unverified' | 'actual-off' = 'linked',
) {
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
  await page.goto(`${origin}/${mode === 'actual-off' ? '' : '?lab=1'}`);
  await page.evaluate(`(async (mode) => {
    const { save, newGame, load, fingerprint } = await import('/src/sim/game.ts');
    const { mountLab, lab, labScreen } = await import('/src/ui/lab.ts');
    lab.setTelemetryOff(mode === 'off' || mode === 'actual-off');
    lab.setPersonaRecording(mode === 'unverified' ? 'unverified-fixture' : null); // Synthetic genuinely fresh component fixture.
    const run = save(newGame(7));
    document.body.innerHTML = '<header class="topbar"><button type="button" data-menu>Menu</button></header>';
    const target = window;
    target.feedbackCalls = []; target.runCalls = []; target.downloadCount = 0; target.recordingChoices = [];
    target.titleCount = 0; target.notebookCount = 0; target.bindCount = 0;
    target.replayFingerprint = (value) => fingerprint(load(value).valley);
    if (mode !== 'actual-off') lab.sendFeedback = async (...args) => { target.feedbackCalls.push(args); return 'feedback-test'; };
    if (mode !== 'actual-off') lab.sendRun = async (...args) => { target.runCalls.push(args); return 'run-test'; };
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
    .getByRole('button', { name: /Feedback/ })
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

it('keeps notebook and pace controls public', async () => {
  const page = await browser.newPage({ viewport: { width: 820, height: 1180 } });
  try {
    await fixture(page);
    const menu = page.locator('.game-menu-panel');
    expect(await menu.locator('[data-notebook]').isVisible()).toBe(true);
    await menu.getByRole('button', { name: 'Fast', exact: true }).click();
    expect(await page.evaluate('window.speed')).toBe('fast');
    await menu.locator('[data-new]').click();
    expect(await menu.locator('[data-new-confirm]').isVisible()).toBe(true);
    await menu.locator('[data-cancel-new]').click();
    expect(await menu.locator('[data-new-confirm]').isVisible()).toBe(false);
  } finally {
    await page.close();
  }
});

it('sends linked feedback with an optional remembered name and keeps a full local copy', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await fixture(page);
    await page.locator('.menu-debug summary').click();
    await page.locator('[data-download]').click();
    await sendWord(page);
    await fits(page);
    const panel = feedback(page);
    expect(await visibleText(panel)).toContain('Send a note about this game.');
    await panel.locator('summary').click();
    const privacy = await panel.locator('details a').boundingBox();
    expect(privacy?.height).toBeGreaterThanOrEqual(44);
    await panel.locator('summary').click();
    const note = panel.locator('textarea').first();
    await note.fill('The winter felt slow.');
    await panel.getByLabel('Your name or tester id', { exact: false }).fill('River tester');
    expect(await visibleText(panel)).toMatch(/name.*(player|history)|history.*name/is);
    expect(await page.evaluate('window.downloadCount')).toBe(1);
    expect(await page.evaluate('!!window.downloadedRun.state && !!window.downloadedRun.savedAt')).toBe(true);
    await panel.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect.poll(() => visibleText(panel)).toContain('Sent. Your note is stored.');
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
    await page.locator('.menu-debug summary').click();
    await page.locator('[data-download]').click();
    await sendWord(page);
    const panel = feedback(page);
    const send = panel.getByRole('button', { name: 'Submit', exact: true });
    expect(await send.isDisabled()).toBe(false);
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
    await panel.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect.poll(async () => (await counts(page)).feedback.length).toBe(1);
    expect((await counts(page)).runs).toHaveLength(0);
    await expect.poll(() => visibleText(panel)).toContain('Sent. Your note is stored.');
  } finally {
    await page.close();
  }
});

it('offers Feedback before starting a run', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  try {
    await fixture(page, 'title');
    await sendWord(page);
    await feedback(page).locator('textarea').first().fill('A note from the title page.');
    await feedback(page).getByRole('button', { name: 'Submit', exact: true }).click();
    await expect.poll(async () => (await counts(page)).feedback.length).toBe(1);
    expect((await counts(page)).runs).toHaveLength(0);
  } finally {
    await page.close();
  }
});

for (const mode of ['off', 'dnt'] as const) {
  for (const checked of [false, true]) {
    it(`submits ${mode} feedback with share checkbox ${checked}`, async () => {
      const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
      try {
        await fixture(page, mode);
        await sendWord(page);
        const panel = feedback(page);
        const checkbox = panel.getByRole('checkbox', {
          name: 'Share this run and my play with the lab',
          exact: true,
        });
        expect(await checkbox.isChecked()).toBe(false);
        if (checked) await checkbox.check();
        expect(await page.evaluate('window.recordingChoices')).toEqual([]);
        await panel.getByRole('button', { name: 'Submit', exact: true }).click();
        await expect.poll(async () => (await counts(page)).feedback.length).toBe(1);
        expect((await counts(page)).feedback[0]?.[1]).toHaveProperty('sharePlay', checked);
      } finally {
        await page.close();
      }
    });
  }
}

it('does not cancel a pending valley when recording identity acknowledges', async () => {
  const page = await browser.newPage();
  try {
    await fixture(page);
    const result = await page.evaluate(`(async () => {
      const {CastSession} = await import('/src/ui/cast-session.ts');
      const {lab} = await import('/src/ui/lab.ts');
      let release;
      const ready = new Promise(resolve => {release=resolve;});
      const session = new CastSession(lab, {ready,enabled:false,setEnabled(){},request:async()=>null});
      session.mount(document.body,()=>{});
      const pending = session.fresh(42,true);
      window.dispatchEvent(new Event('hf-lab-preference'));
      window.dispatchEvent(new StorageEvent('storage',{key:'hf-lab-player'}));
      release(true);
      await pending;
      return true;
    })()`);
    expect(result).toBe(true);
  } finally {
    await page.close();
  }
});

it('keeps quiet Feedback choices local and submits the literal note through the installed SDK', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 690 } });
  const payloads: Record<string, unknown>[] = [];
  try {
    await fixture(page, 'actual-off');
    await page.route('https://human.adamwhite.work/**', async (route) => {
      const body = route.request().postDataBuffer();
      if (body) payloads.push(JSON.parse(gunzipSync(body).toString()));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'mock-note-only-receipt' }),
      });
    });
    await sendWord(page);
    const panel = feedback(page);
    const stopping = panel.getByRole('button', { name: "I'm stopping", exact: true });
    const confused = panel.getByRole('button', { name: "I'm confused", exact: true });
    expect(await stopping.isVisible()).toBe(true);
    expect(await confused.isVisible()).toBe(true);
    const note = panel.locator('textarea').first();
    await stopping.click();
    expect(await note.inputValue()).toBe("I'm stopping");
    await note.fill("I'm stopping because the grain account is unclear.\n\nKeep this detail.");
    const edited = await note.inputValue();
    await confused.click();
    expect(await note.inputValue()).toBe(`I'm confused\n\n${edited}`);
    await confused.click();
    expect(await note.inputValue()).toBe(edited);
    await stopping.click();
    await confused.click();
    expect(await note.inputValue()).toBe(`I'm confused\n\n${edited}`);
    expect(payloads).toEqual([]);
    const sharing = panel.getByRole('checkbox', {
      name: 'Share this run and my play with the lab',
      exact: true,
    });
    expect(await sharing.isChecked()).toBe(false);
    await panel.getByRole('button', { name: 'Not sure', exact: true }).click();
    await panel.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect.poll(() => visibleText(panel)).toContain('Sent. Your note is stored.');
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      note: `Verdict: mixed.\n\nI'm confused\n\n${edited}`,
      run: { feedbackOnly: true },
    });
    expect(payloads[0]?.run).toEqual({ feedbackOnly: true });
    expect(JSON.stringify(payloads)).not.toContain('state');
    expect(await visibleText(panel)).toContain('mock-note-only-receipt');
  } finally {
    await page.close();
  }
});

it('offers ordinary file download and close without exposing New game', async () => {
  const page = await browser.newPage();
  try {
    await page.route('**/src/main.ts', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
    );
    await page.goto(`${origin}/file/`);
    await page.evaluate(`(async () => {
      const { mountLab, openMenu } = await import('/src/ui/lab.ts');
      mountLab({ getRun:()=>undefined, hasRun:()=>false, chooseRecording:async()=>{}, download:()=>{document.body.dataset.download='requested'}, bindVolume:async()=>{}, notebook:()=>{}, toTitle:()=>{document.body.dataset.fileOpen='requested'}, closeFile:()=>{document.body.dataset.fileClose='requested'}, getSpeed:()=>'automatic', setSpeed:()=>{}, date:()=>'' });
      openMenu();
    })()`);
    expect(await page.getByRole('button', { name: 'New game', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Close file session', exact: true }).click();
    expect(await page.locator('body').getAttribute('data-file-close')).toBe('requested');
  } finally {
    preserveFileBrowser = true;
    const pending = await page.evaluate(async () => {
      if (!(await indexedDB.databases()).some((d) => d.name === 'hf-lab-pending')) return 0;
      return new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('hf-lab-pending');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const count = db.transaction('pieces').objectStore('pieces').count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
          count.onerror = () => reject(count.error);
        };
      });
    });
    expect(pending).toBe(0);
    preserveFileBrowser = false;
    await page.close();
  }
});

// Direct persistent ownership: no fixture or automatic context teardown may discard pending data.
it('preserves SDK state before real file startup and reports recording refusal honestly', async () => {
  const proof = mkdtempSync(join(process.env.VALLEY_SDK_PROOF_ROOT ?? tmpdir(), 'valley-sdk-'));
  const profile = join(proof, 'profile');
  let context: BrowserContext | undefined;
  let page: Page;
  let componentClosedEmpty = false;
  preserveFileBrowser = true;
  const observations: unknown[] = [];
  const requests: string[] = [];
  const snapshot = () =>
    page.evaluate(async () => {
      const encode = async (value: unknown): Promise<unknown> => {
        if (value === undefined) return { undefined: true };
        if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
        if (value instanceof Blob || value instanceof ArrayBuffer) {
          const bytes = new Uint8Array(value instanceof Blob ? await value.arrayBuffer() : value);
          let text = '';
          for (const byte of bytes) text += String.fromCharCode(byte);
          return {
            binary: btoa(text),
            bytes: bytes.length,
            type: value instanceof Blob ? 'Blob' : 'ArrayBuffer',
            mime: value instanceof Blob ? value.type : null,
          };
        }
        if (Array.isArray(value)) return Promise.all(value.map(encode));
        if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
          throw Error('Unsupported backup value; preserve this profile.');
        return Object.fromEntries(
          await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await encode(item)])),
        );
      };
      const databases = [];
      for (const info of await indexedDB.databases()) {
        if (!info.name) throw Error('Unnamed database; preserve this profile.');
        const request = indexedDB.open(info.name);
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const stores = [];
          for (const name of db.objectStoreNames) {
            const tx = db.transaction(name);
            const store = tx.objectStore(name);
            const keysRequest = store.getAllKeys();
            const valuesRequest = store.getAll();
            const [keys, values] = await Promise.all(
              [keysRequest, valuesRequest].map(
                (r) =>
                  new Promise<unknown[]>((resolve, reject) => {
                    r.onsuccess = () => resolve(r.result);
                    r.onerror = () => reject(r.error);
                  }),
              ),
            );
            const indexes = [...store.indexNames].map((n) => {
              const index = store.index(n);
              return { name: n, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
            });
            stores.push({
              name,
              keyPath: store.keyPath,
              autoIncrement: store.autoIncrement,
              indexes,
              keys: await encode(keys),
              values: await encode(values),
            });
          }
          databases.push({ name: db.name, version: db.version, stores });
        } finally {
          db.close();
        }
      }
      return {
        origin: location.origin,
        localStorage: { ...localStorage },
        sessionStorage: { ...sessionStorage },
        databases,
      };
    });
  const retain = (name: string, value: unknown) => {
    const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
    const path = join(proof, name);
    writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
    expect(readFileSync(path).equals(bytes)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(value);
    return createHash('sha256').update(bytes).digest('hex');
  };
  const bounded = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(Error('Final preservation read timed out; HOLD profile.')), 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const hold = async (error: unknown): Promise<never> => {
    console.error('HOLD: no automatic cleanup; retain browser/profile', profile, error);
    return new Promise<never>(() => {
      setInterval(() => {}, 1000);
    });
  };
  try {
    const componentContexts = browser.contexts();
    retain('component-browser-empty.json', {
      contexts: componentContexts.length,
      pages: componentContexts.map((c) => c.pages().map((p) => p.url())),
    });
    if (componentContexts.length !== 0) await hold('Unexpected component context; queue unobserved.');
    await browser.close();
    componentClosedEmpty = true;
    context = await chromium.launchPersistentContext(profile, { handleSIGTERM: false });
    page = context.pages()[0] ?? (await context.newPage());
    page.on('request', (request) => {
      if (request.url().startsWith('https://human.adamwhite.work/'))
        requests.push(request.method() + ' ' + request.url());
    });
    page.setDefaultTimeout(5000);
    await page.goto(origin + '/icon.svg');
    const pristine = await snapshot();
    expect(pristine.databases).toEqual([]);
    expect(pristine.localStorage).toEqual({});
    expect(pristine.sessionStorage).toEqual({});
    retain('initial-pristine.json', pristine);
    await page.goto(origin + '/file/?labRunSource=agent');
    await page.getByLabel('Open a Valley file').waitFor();
    await expect
      .poll(() => page.locator('[data-recording-status]').textContent())
      .toContain('no compatible recording identity');
    expect(await page.locator('.notice-footer .lk-telemetry-notice').count()).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('hf-lab-player'))).toBeNull();
    expect(page.url()).not.toContain('labRunSource');
    observations.push({ phase: 'missing-identity', state: await snapshot() });
    // Synthetic occupied origin only after the read-only pristine inventory above.
    await page.goto(origin + '/icon.svg');
    await page.evaluate(async () => {
      localStorage.setItem('hf-lab-player', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      localStorage.setItem('hf-lab-recording-off', '1');
      localStorage.setItem('hf-lab-events-off:valley', '1');
      localStorage.setItem('valley-log-v1', 'occupied-owner-sentinel');
      localStorage.setItem('hf-lab:once:telemetry-notice-v1', '1');
      sessionStorage.setItem('hf-lab-session:valley', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:' + Date.now());
      sessionStorage.setItem('hf-lab-run:valley', 'cccccccccccccccccccccccccccccccc');
      const request = indexedDB.open('valley', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('volumes');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction('volumes', 'readwrite');
      tx.objectStore('volumes').put(
        { blob: new Blob(['owner-current'], { type: 'application/gzip' }), at: 1 },
        'current',
      );
      tx.objectStore('volumes').put(
        { blob: new Blob(['owner-history'], { type: 'application/gzip' }), at: 2 },
        'history',
      );
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    const occupied = await snapshot();
    retain('occupied-before.json', occupied);
    await page.clock.install();
    await page.goto(origin + '/file/?labRunSource=agent');
    await page.clock.pauseAt(Date.now() + 50);
    await page.getByLabel('Open a Valley file').waitFor();
    await expect
      .poll(() => page.locator('[data-recording-status]').textContent())
      .toContain('Recording is inactive');
    expect(await page.locator('.notice-footer .lk-telemetry-notice').count()).toBe(0);
    const fileBytes = process.env.VALLEY_SELECTED_FILE
      ? readFileSync(process.env.VALLEY_SELECTED_FILE)
      : Buffer.from(
          // Synthetic CI input uses the public export's explicit empty provenance maps.
          JSON.stringify({ ...save(newGame(7), 0), castHeads: {}, castSourceRefs: {} }),
        );
    const selected = JSON.parse(fileBytes.toString('utf8'));
    const importFile = async (bytes: Buffer) => {
      await page
        .getByLabel('Open a Valley file')
        .setInputFiles({ name: 'valley.json', mimeType: 'application/json', buffer: bytes });
      await expect.poll(() => page.locator('#map').count(), { timeout: 30000 }).toBe(1);
    };
    const downloadFile = async (name: string) => {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download this Valley file', exact: true }).click();
      const stream = await (await pending).createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      writeFileSync(join(proof, name), bytes, { flag: 'wx', mode: 0o600 });
      expect(readFileSync(join(proof, name)).equals(bytes)).toBe(true);
      return JSON.parse(bytes.toString('utf8'));
    };
    await importFile(fileBytes);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const exported = await downloadFile('actual-initial-export.json');
    const body = (value: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(value).filter(([key]) => !['savedAt', 'label'].includes(key)));
    expect(body(exported)).toEqual(body(selected));
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    const action = page.locator('#thumbs button.primary');
    const actionText = await action.textContent();
    await action.click();
    await page.clock.runFor(1000);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const advanced = await downloadFile('actual-after-action-export.json');
    expect(advanced.inputs.length).toBeGreaterThan(exported.inputs.length);
    expect(advanced.state.people).toHaveLength(selected.state.people.length);
    expect(advanced.state.kahya).toBeDefined();
    expect(stateJson(load(advanced).valley)).toEqual(advanced.state);
    const replayed = stateJson(
      replay(
        advanced.seed,
        advanced.inputs,
        advanced.minute,
        advanced.cast,
        advanced.plainEnglish,
        advanced.rules,
      ).valley,
    );
    expect(JSON.parse(JSON.stringify(replayed))).toEqual(advanced.state);
    await page.getByRole('button', { name: 'Open another Valley file', exact: true }).click();
    await importFile(Buffer.from(JSON.stringify(advanced)));
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const reimported = await downloadFile('actual-reimport-export.json');
    expect(body(reimported)).toEqual(body(advanced));
    await page.getByRole('button', { name: 'Close file session', exact: true }).click();
    await page.getByLabel('Open a Valley file').waitFor();
    expect(await snapshot()).toEqual(occupied);
    observations.push({
      phase: 'full-selected-off-preference',
      people: selected.state.people.length,
      actionText,
      selectedSha256: createHash('sha256').update(fileBytes).digest('hex'),
      replayEquality: 'full JSON wire equality; signed zero is not distinguishable in JSON',
      state: await snapshot(),
    });
    await page.goto(origin + '/icon.svg');
    await page.evaluate(() => sessionStorage.setItem('hf-lab-session:valley', 'invalid-existing-session'));
    const incompatible = await snapshot();
    await page.goto(origin + '/file/');
    await page.getByLabel('Open a Valley file').waitFor();
    await expect
      .poll(() => page.locator('[data-recording-status]').textContent())
      .toContain('cannot be reused');
    expect(await page.locator('.notice-footer .lk-telemetry-notice').count()).toBe(0);
    expect(await snapshot()).toEqual(incompatible);
    expect(requests).toEqual([]);
    observations.push({ phase: 'incompatible-session', state: await snapshot() });
  } finally {
    // A verified private backup is always retained; only an actual zero queue permits closing.
    // With timeout0 this loop keeps the direct context/profile alive even when a backup write fails.
    if (context)
      for (;;) {
        try {
          const [state, cookies] = await bounded(Promise.all([snapshot(), context.cookies()]));
          const backup = {
            state,
            cookies,
            observations,
            requests,
            profile,
            restoration:
              'Restore all listed origin keys and exact DB schemas/keys/values; binary base64 decodes to Blob(mime) or ArrayBuffer. Captured session keys remain private; do not transplant into an owner profile.',
          };
          const pending = state.databases.find((db) => db.name === 'hf-lab-pending');
          const pieces = pending?.stores.find((store) => store.name === 'pieces');
          if (pending && !pieces) await hold('Pending schema unknown; HOLD profile.');
          if (pieces && (!Array.isArray(pieces.values) || pieces.values.length !== 0)) {
            retain('nonzero-pending-private-backup.json', backup);
            await hold('Pending nonzero; HOLD profile even after backup.');
          }
          const digest = retain('complete-final-private-backup.json', { ...backup, pendingCount: 0 });
          console.log('VALLEY_SDK_COMPLETE_BACKUP=' + proof + ' SHA256=' + digest);
          await context.close();
          preserveFileBrowser = false;
          break;
        } catch (error) {
          await hold(error);
        }
      }
    else if (componentClosedEmpty) preserveFileBrowser = false;
    else await hold('Component context preservation was not established.');
  }
}, 0);
