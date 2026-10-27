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
  expect(g.valley.notes.some((n) => n.text.startsWith('You say'))).toBe(true);
  // Someone in the house answers the saying (or, if no one can, the house nods); nothing else changes.
  expect(g.valley.notes.at(-1)?.text).not.toMatch(/^You say/);
  expect(g.valley.agha.granary).toBe(grain);
  expect(JSON.stringify(g.valley.people)).toBe(people);
  expect(act(g, { verb: 'reply', house: 'kavak' })).toBe(false);
  // Without a put-off call, the "finish first" and rain sayings are not offered.
  expect(act(g, { verb: 'reply', house: 'kavak', saying: 'finish' })).toBe(false);
  expect(act(g, { verb: 'reply', house: 'kavak', saying: 'rain' })).toBe(false);
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

// The three sayings: each is offered only when it fits, gets a household answer, and replays exactly.
it('offers finish-first and rain sayings only to a house that put off the call, and replays them', async () => {
  const { DAY } = await import('../src/sim/calendar.ts');
  const { REPLY_EDITION } = await import('../src/sim/edition.ts');
  const { houseOf, sayingsAt } = await import('../src/sim/valley.ts');
  const g = newGame(5, undefined, false, true, REPLY_EDITION);
  const s = g.valley;
  step(g, 7 * 60 + 30);
  const houses = s.households.filter((h) => h.members.length && h.hamlet === 'lower').map((h) => h.id);
  expect(act(g, { verb: 'call', job: 'reap-agha', houses })).toBe(true);
  for (let m = s.minute + 10; m < DAY; m += 10) {
    if (Object.values(s.asks[0]?.replies ?? {}).some((r) => r.verdict === 'deferred')) break;
    step(g, m);
  }
  const ask = s.asks[0];
  const house = s.households.find((h) => h.members.some((id) => ask?.replies[id]?.verdict === 'deferred'));
  if (!ask || !house) throw new Error('Missing put-off house');
  expect(act(g, { verb: 'visit', house: house.id })).toBe(true);
  step(g, (s.kahyaState.visit?.arrive ?? 0) + 30);
  expect(sayingsAt(s, house)).toEqual(['listen', 'finish', 'rain']);
  const replies = JSON.stringify(ask.replies);
  for (const saying of ['listen', 'finish', 'rain'] as const) {
    expect(act(g, { verb: 'reply', house: house.id, saying })).toBe(true);
    expect(act(g, { verb: 'reply', house: house.id, saying })).toBe(false);
  }
  step(g, s.minute + 10);
  // Each saying has an answer from the house; the reply to the call is unchanged.
  expect(
    s.notes.filter(
      (n) => n.house === house.id && n.kind === 'voice' && n.at > (s.kahyaState.visit?.arrive ?? 0),
    ).length,
  ).toBeGreaterThanOrEqual(3);
  expect(JSON.stringify(ask.replies)).toBe(replies);
  // A house that was not called hears only the greeting.
  const other = s.households.find((h) => h.members.length && !houses.includes(h.id));
  if (!other) throw new Error('Missing uncalled house');
  expect(sayingsAt(s, houseOf(s, other.id) ?? other)).toEqual(['listen']);
  expect(fingerprint(load(compactRun(g)).valley)).toBe(fingerprint(s));
  const bad = structuredClone(save(g));
  bad.state.reply = { id: bad.state.reply?.id, visits: [`${house.id}:1:shout`] } as never;
  expect(() => restoreState(bad.state)).toThrow();
});
