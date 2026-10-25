import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { acquireSuiteLock } from '../scripts/suite-lock.ts';

it('recovers an abruptly killed holder and serializes two later acquisitions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'valley-suite-lock-'));
  const directory = join(root, 'lock');
  const module = new URL('../scripts/suite-lock.ts', import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { acquireSuiteLock } from ${JSON.stringify(module)};
    await acquireSuiteLock({ directory: ${JSON.stringify(directory)}, repo: 'control', branch: 'test', env: {} });
    console.log('ACQUIRED');
    setInterval(() => {}, 1000);
  `,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let release: (() => void) | undefined;
  try {
    await once(child.stdout, 'data');
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    const options = {
      directory,
      repo: 'control',
      branch: 'test',
      env: {},
      log: () => {},
      wait: () => new Promise<void>((done) => setTimeout(done, 10)),
    };
    release = await acquireSuiteLock(options);
    let entered = false;
    const next = acquireSuiteLock(options).then((unlock) => {
      entered = true;
      return unlock;
    });
    await new Promise((done) => setTimeout(done, 30));
    expect(entered).toBe(false);
    release();
    (await next)();
    expect(entered).toBe(true);
  } finally {
    release?.();
    child.kill('SIGTERM');
    rmSync(root, { recursive: true, force: true });
  }
});
