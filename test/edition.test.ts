import { expect, it } from 'vitest';
import { DAY } from '../src/sim/calendar.ts';
import { compactRun, fingerprint, load, newGame, save, step } from '../src/sim/game.ts';

it('pins the optional rules edition through both exports and preserves unmarked continuation', () => {
  const legacy = newGame(7);
  const oldHash = fingerprint(legacy.valley);
  const current = newGame(7, undefined, false, true, 'valley-2026-10');
  expect(current.valley.edition?.id).toBe('valley-2026-10');
  step(current, DAY);
  const expected = fingerprint(current.valley);
  expect(fingerprint(load(compactRun(current)).valley)).toBe(expected);
  expect(fingerprint(load(save(current)).valley)).toBe(expected);
  expect(fingerprint(newGame(7).valley)).toBe(oldHash);
  expect(save(legacy)).not.toHaveProperty('rules');
});
