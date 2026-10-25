import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

it('fails closed on an interrupted owner publication without removing an unidentified lock', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'valley-orphan-lock-'));
  try {
    for (const incomplete of [false, true]) {
      const directory = join(temp, incomplete ? 'incomplete' : 'empty');
      mkdirSync(directory);
      if (incomplete) writeFileSync(join(directory, 'owner.json'), '{');
      let waits = 0;
      await expect(
        acquireSuiteLock({
          directory,
          repo: 'isolated-control',
          branch: 'control',
          env: {},
          log() {},
          async wait() {
            if (++waits > 8) throw new Error('Bounded test stop: orphan did not fail closed');
          },
        }),
      ).rejects.toThrow(/no readable owner/);
      expect(waits).toBe(5);
      expect(existsSync(directory)).toBe(true);
      expect(incomplete ? readFileSync(join(directory, 'owner.json'), 'utf8') : '').toBe(
        incomplete ? '{' : '',
      );
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

it('lets an older contender publish its live owner without replacing its lock', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'valley-live-lock-'));
  const directory = join(temp, 'full-suite');
  mkdirSync(directory);
  const owner = { pid: process.pid, repo: 'older-contender', branch: 'old', started: 'old-publication' };
  const stop = new Error('Bounded live-owner observation complete');
  let waits = 0;
  try {
    await expect(
      acquireSuiteLock({
        directory,
        repo: 'new-contender',
        branch: 'new',
        env: {},
        log() {},
        async wait() {
          waits++;
          if (waits === 2) writeFileSync(join(directory, 'owner.json'), JSON.stringify(owner));
          if (waits === 9) throw stop;
        },
      }),
    ).rejects.toBe(stop);
    expect(JSON.parse(readFileSync(join(directory, 'owner.json'), 'utf8'))).toEqual(owner);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

it('releases only its own normal acquisition and leaves no test lock', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'valley-own-lock-'));
  const directory = join(temp, 'full-suite');
  try {
    const release = await acquireSuiteLock({
      directory,
      repo: 'isolated-control',
      branch: 'control',
      env: {},
    });
    expect(JSON.parse(readFileSync(join(directory, 'owner.json'), 'utf8')).pid).toBe(process.pid);
    release();
    release();
    expect(existsSync(directory)).toBe(false);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
