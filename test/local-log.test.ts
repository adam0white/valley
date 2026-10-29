import { expect, it } from 'vitest';
import { validLocalLog } from '../src/ui/local-log.ts';

const base = {
  game: 'valley',
  version: '0.4.0',
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

it('preserves millisecond visit anchors and refuses invented submillisecond times', () => {
  const input = {
    at: 870,
    verb: 'dialogue',
    turn: 0,
    house: 'coban',
    person: 'zehra',
    visit: 860.0001,
    prior: 5,
    line: 'reciprocal-help',
  };
  const log = { ...base, minute: 870, rules: 'valley-public-2026-10', inputs: [input] };
  expect(validLocalLog(JSON.parse(JSON.stringify(log)))).toBe(true);
  const offer = {
    at: 870,
    verb: 'help-offer',
    house: 'coban',
    person: 'zehra',
    ask: 'a1-420',
    visit: input.visit,
  };
  expect(validLocalLog({ ...log, inputs: [offer] })).toBe(true);
  for (const visit of [NaN, Infinity, -1, 900, 860 + 0.5 / 60000]) {
    expect(validLocalLog({ ...log, inputs: [{ ...input, visit }] })).toBe(false);
    expect(validLocalLog({ ...log, inputs: [{ ...offer, visit }] })).toBe(false);
  }
});
