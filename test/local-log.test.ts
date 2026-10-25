import { expect, it } from 'vitest';
import { validLocalLog } from '../src/ui/local-log.ts';

const base = {
  game: 'valley',
  version: '0.3.0',
  seed: 7,
  minute: 600,
  inputs: [],
  volume: 0,
  plainEnglish: true,
};
it('refuses malformed local logs before Resume or continuity admission', () => {
  expect(validLocalLog(base)).toBe(true);
  expect(
    validLocalLog({ ...base, inputs: [{ at: 420, verb: 'insist', ask: 'a1-420', pid: 'topal-rıza' }] }),
  ).toBe(true);
  for (const bad of [
    null,
    { ...base, minute: 1e20 },
    { ...base, volume: -1 },
    { ...base, seed: '7' },
    { ...base, rules: 'unknown' },
    { ...base, inputs: [{ at: 601, verb: 'borrow', kile: 80 }] },
    { ...base, inputs: [{ at: 420, verb: 'give', house: 'coban', kile: -1 }] },
    { ...base, inputs: [{ at: 420, verb: 'unknown' }] },
    { ...base, continuity: { runId: '../other' } },
  ])
    expect(validLocalLog(bad)).toBe(false);
});
