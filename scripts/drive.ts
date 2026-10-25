/**
 * A playtest driver: the real game in a headless phone browser, with time frozen between commands, so a
 * playtester who reads slowly does not lose the valley while thinking. It shows only what the screen shows.
 *
 *   node scripts/drive.ts serve <port> [url] [shots-dir]   start the browser (keeps running)
 *   node scripts/drive.ts <port> look                      the screen as text, and a screenshot
 *   node scripts/drive.ts <port> tap <n | button text>     press a button (held buttons are held)
 *   node scripts/drive.ts <port> house <name>              tap a house on the map
 *   node scripts/drive.ts <port> wait <seconds>            let real play time pass at the current speed
 *   node scripts/drive.ts <port> export <file>             save the playtest export
 *   node scripts/drive.ts <port> quit                      close the browser
 */
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';

const [a0, a1, a2, a3] = process.argv.slice(2);

if (a0 === 'serve') {
  const port = Number(a1);
  const url = a2 ?? 'https://valley.adamwhite.work/';
  const shots = a3 ?? join(process.cwd(), 'scratch', `shots-${port}`);
  mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: false,
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  await page.clock.install({ time: Date.now() });
  await page.goto(url);
  await page.clock.pauseAt(Date.now() + 1000);
  await page.clock.runFor(1500);
  let shot = 0;
  const run = async (cmd: string, arg: string): Promise<string> => {
    if (cmd === 'look') return look(page, join(shots, `${String(++shot).padStart(3, '0')}.png`));
    if (cmd === 'tap')
      return (await tap(page, arg)) ?? look(page, join(shots, `${String(++shot).padStart(3, '0')}.png`));
    if (cmd === 'house') {
      const ok = await page.evaluate((name) => {
        const want = name
          .toLowerCase()
          .replace(/^the /, '')
          .replace(/ house$/, '');
        const b = [...document.querySelectorAll<HTMLButtonElement>('#houses button')].find(
          (x) =>
            (x.textContent ?? '')
              .toLowerCase()
              .replace(/^the /, '')
              .replace(/ house$/, '') === want,
        );
        b?.click();
        return !!b;
      }, arg);
      if (!ok) return `No house called "${arg}" on the map.`;
      await page.clock.runFor(300);
      return look(page, join(shots, `${String(++shot).padStart(3, '0')}.png`));
    }
    if (cmd === 'wait') {
      const s = Math.max(0, Math.min(600, Number(arg) || 0));
      for (let t = 0; t < s; t += 1) await page.clock.runFor(1000);
      return look(page, join(shots, `${String(++shot).padStart(3, '0')}.png`));
    }
    if (cmd === 'export') {
      const [dl] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('button', { hasText: 'Export the playtest' }).first().click(),
      ]);
      await dl.saveAs(arg);
      return `Saved ${dl.suggestedFilename()} to ${arg}`;
    }
    if (cmd === 'quit') {
      setTimeout(() => process.exit(0), 50);
      await browser.close();
      return 'closed';
    }
    return `Unknown command ${cmd}`;
  };
  let queue = Promise.resolve();
  createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      const { cmd, arg } = JSON.parse(body || '{}') as { cmd: string; arg: string };
      queue = queue.then(async () => {
        try {
          res.end(await run(cmd, arg ?? ''));
        } catch (e) {
          res.end(`error: ${(e as Error).message}`);
        }
      });
    });
  }).listen(port, '127.0.0.1', () => console.log(`driving ${url} on ${port}`));
} else {
  const res = await fetch(`http://127.0.0.1:${a0}/`, {
    method: 'POST',
    body: JSON.stringify({ cmd: a1, arg: process.argv.slice(4).join(' ') }),
  });
  console.log(await res.text());
}

async function look(page: Page, path: string): Promise<string> {
  await page.screenshot({ path });
  const text = await page.evaluate(() => {
    const out: string[] = [];
    const cap = document.querySelector('#cap')?.textContent;
    if (cap) out.push(`[map] ${cap}`);
    const speed = [...document.querySelectorAll('#speed button')]
      .map((b) => (b.classList.contains('on') ? `(${b.textContent})` : b.textContent))
      .join(' ');
    if (speed) out.push(`[speed] ${speed}`);
    const main = document.querySelector('#sheet') ?? document.querySelector('.page') ?? document.body;
    // biome-ignore lint/performance/useDomNodeTextContent: The driver reads rendered text; hidden text must stay excluded.
    out.push((main as HTMLElement).innerText.trim());
    const thumbs = document.querySelector('#thumbs') as HTMLElement | null;
    // biome-ignore lint/performance/useDomNodeTextContent: The driver reads rendered text; hidden text must stay excluded.
    if (thumbs) out.push(`[bottom] ${thumbs.innerText.trim()}`);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => !b.closest('#houses') && !b.closest('#speed') && b.offsetParent !== null,
    );
    out.push(
      // biome-ignore lint/performance/useDomNodeTextContent: The driver reads rendered text; hidden text must stay excluded.
      `[buttons] ${buttons.map((b, i) => `${i + 1}. ${b.innerText.replace(/\s+/g, ' ').trim()}${b.disabled ? ' (greyed)' : ''}${b.classList.contains('hold') ? ' (hold)' : ''}`).join(' | ')}`,
    );
    const houses = [...document.querySelectorAll('#houses button')].map((b) => b.textContent).join(', ');
    if (houses) out.push(`[houses on the map] ${houses}`);
    return out.join('\n');
  });
  return `${text}\n[screenshot] ${path}`;
}

async function tap(page: Page, arg: string): Promise<string | null> {
  const found = await page.evaluate((arg) => {
    for (const b of document.querySelectorAll('[data-drive]')) b.removeAttribute('data-drive');
    const speed = ['slow', 'steady', 'fast'].indexOf(arg);
    let b: HTMLButtonElement | undefined;
    if (speed >= 0) b = document.querySelectorAll<HTMLButtonElement>('#speed button')[speed];
    else {
      const all = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(
        (x) => !x.closest('#houses') && !x.closest('#speed') && x.offsetParent !== null,
      );
      const n = Number(arg);
      b =
        Number.isInteger(n) && n > 0
          ? all[n - 1]
          : // biome-ignore lint/performance/useDomNodeTextContent: The driver reads rendered text; hidden text must stay excluded.
            (all.find((x) => x.innerText.replace(/\s+/g, ' ').trim().startsWith(arg)) ??
            // biome-ignore lint/performance/useDomNodeTextContent: The driver reads rendered text; hidden text must stay excluded.
            all.find((x) => x.innerText.includes(arg)));
    }
    if (!b) return null;
    b.setAttribute('data-drive', '1');
    return { hold: b.classList.contains('hold'), disabled: b.disabled };
  }, arg);
  if (!found) return `No button "${arg}".`;
  if (found.disabled) return 'That button is greyed out.';
  const b = page.locator('[data-drive]');
  if (found.hold) {
    await b.scrollIntoViewIfNeeded();
    const box = await b.boundingBox();
    if (!box) return 'That button is not on screen.';
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.clock.runFor(1600);
    await page.mouse.up();
  } else await b.click();
  await page.clock.runFor(400);
  return null;
}
