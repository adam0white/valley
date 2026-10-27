import { expect, it } from 'vitest';
import { localEdition } from '../src/sim/edition.ts';
import { act, compactRun, fingerprint, load, newGame, restoreState, save, step } from '../src/sim/game.ts';
import { validLocalLog } from '../src/ui/local-log.ts';

it('plays spoken visits with the public grain and pass world and replays the combined term exactly', () => {
  const g = newGame(7, undefined, false, true, 'valley-public-2026-10');
  expect(localEdition('valley-public-2026-10')).toBe(true); // Keep the cast-region exclusion.
  expect(g.valley.edition).toBeDefined();
  expect(g.valley.pass).toBeDefined();
  expect(g.valley.stewardCare).toBeDefined();
  expect(g.valley.dialogue).toBeDefined();
  expect(act(g, { verb: 'visit', house: 'kavak' })).toBe(true);
  step(g, g.valley.minute + 30);
  expect(act(g, { verb: 'reply', house: 'kavak' })).toBe(true);
  expect(g.valley.notes.at(-1)?.text).not.toMatch(/^You say/);
  const saved = save(g);
  expect(saved.rules).toBe('valley-public-2026-10');
  expect(fingerprint(load(saved).valley)).toBe(fingerprint(g.valley));
  expect(fingerprint(load(compactRun(g)).valley)).toBe(fingerprint(g.valley));
  expect(validLocalLog({ ...compactRun(g), volume: 0 })).toBe(true);
  step(g, g.valley.minute + 60);
  const resumed = load(saved);
  step(resumed, g.valley.minute);
  expect(fingerprint(resumed.valley)).toBe(fingerprint(g.valley));
});

it('rejects partial public worlds and keeps legacy edition boundaries intact', () => {
  const original = save(newGame(7, undefined, false, true, 'valley-public-2026-10'));
  for (const field of ['reply', 'dialogue', 'pass', 'stewardCare'] as const) {
    const partial = structuredClone(original);
    delete partial.state[field];
    expect(() => load(partial)).toThrow();
    expect(() => restoreState(partial.state)).toThrow();
  }
});
