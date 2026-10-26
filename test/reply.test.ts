import { expect, it } from 'vitest';
import type { RulesEdition } from '../src/sim/edition.ts';
import { act, compactRun, fingerprint, load, newGame, restoreState, save, step } from '../src/sim/game.ts';

const replies = 'valley-replies-2026-10' as RulesEdition;
it('adds a bounded attended reply without enabling October grain rules and replays it', () => {
  const g = newGame(7, undefined, false, true, replies);
  expect(g.valley.edition).toBeUndefined();
  expect(act(g, { verb: 'reply', house: 'kavak' })).toBe(false);
  expect(act(g, { verb: 'visit', house: 'kavak' })).toBe(true);
  step(g, g.valley.minute + 30);
  const grain = g.valley.agha.granary;
  const people = JSON.stringify(g.valley.people);
  expect(act(g, { verb: 'reply', house: 'kavak' })).toBe(true);
  expect(g.valley.notes.at(-1)?.text).toContain('You say');
  expect(g.valley.agha.granary).toBe(grain);
  expect(JSON.stringify(g.valley.people)).toBe(people);
  expect(act(g, { verb: 'reply', house: 'kavak' })).toBe(false);
  expect(fingerprint(load(save(g)).valley)).toBe(fingerprint(g.valley));
  expect(fingerprint(load(compactRun(g)).valley)).toBe(fingerprint(g.valley));
  for (const rules of [
    undefined,
    'valley-2026-10',
    'valley-pass-2026-10',
    'valley-alliance-2026-10',
  ] as const) {
    const old = newGame(7, undefined, false, true, rules);
    act(old, { verb: 'visit', house: 'kavak' });
    step(old, old.valley.minute + 30);
    const before = fingerprint(old.valley);
    expect(act(old, { verb: 'reply', house: 'kavak' })).toBe(false);
    expect(fingerprint(old.valley)).toBe(before);
  }
});

it('rejects malformed reply state at the shared full-save and bound-volume restoration boundary', async () => {
  const { restoreState } = await import('../src/sim/game.ts');
  const saved = save(newGame(7, undefined, false, true, replies));
  const mixed = structuredClone(saved);
  mixed.state.edition = { id: 'valley-2026-10' };
  expect(() => restoreState(mixed.state)).toThrow(/reply/i);
  expect(() => load(mixed)).toThrow(/reply/i);
  const invalid = [
    { id: replies, visits: [], edition: true },
    { id: 'wrong', visits: [] },
    null,
    { id: replies, visits: 'kavak:440' },
    { id: replies, visits: ['kavak:440', 'kavak:440'] },
    { id: replies, visits: ['kavak:NaN'] },
    { id: replies, visits: ['kavak:Infinity'] },
    { id: replies, visits: ['kavak:999999999'] },
    { id: replies, visits: ['kavak:450'] },
    { id: replies, visits: ['missing:400'] },
    { id: replies, visits: ['kavak:0400'] },
    { id: replies, visits: [400] },
  ];
  for (const reply of invalid) {
    const broken = structuredClone(saved);
    broken.state.reply = reply as never;
    if (reply && typeof reply === 'object' && 'edition' in reply)
      broken.state.edition = { id: 'valley-2026-10' };
    expect(() => restoreState(broken.state)).toThrow(/reply/i);
    expect(() => load(broken)).toThrow();
  }
});

it.each(['pass', 'stewardCare', 'introduction', 'brokering'] as const)(
  'rejects mixed reply recovery with %s at the shared restoration boundary',
  (field) => {
    const saved = save(newGame(7, undefined, false, true, replies));
    Object.assign(saved.state, { [field]: field === 'stewardCare' ? { grain: 0, eaten: 0 } : {} });
    // Full file loads already reject this world. Bound recovery calls restoreState directly.
    expect(() => load(saved)).toThrow();
    expect(() => restoreState(saved.state)).toThrow(/reply/i);
  },
);
