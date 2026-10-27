import { expect, it } from 'vitest';
import { validLocalLog } from '../src/ui/local-log.ts';

const base = {
  game: 'valley',
  version: '0.3.1',
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

it('admits reply inputs only for reply rules and October inputs only for their grain rules', () => {
  expect(
    validLocalLog({
      ...base,
      rules: 'valley-replies-2026-10',
      inputs: [{ at: 420, verb: 'reply', house: 'kavak' }],
    }),
  ).toBe(true);
  for (const input of [
    { at: 420, verb: 'topic', house: 'kavak', topic: 'person' },
    { at: 420, verb: 'term-choice', id: 'winter', choice: 'grain' },
  ]) {
    expect(validLocalLog({ ...base, rules: 'valley-replies-2026-10', inputs: [input] })).toBe(false);
    expect(validLocalLog({ ...base, rules: 'valley-2026-10', inputs: [input] })).toBe(true);
  }
});
