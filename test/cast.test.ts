import { describe, expect, it } from 'vitest';
import { ageYears, spousesOf } from '../src/sim/hf.ts';
import { foundValley } from '../src/sim/people.ts';

describe('canonical historical Valley opening', () => {
  it('keeps the two Yusufs distinct and preserves family and pregnancy', () => {
    const { people } = foundValley(42, 0);
    const byId = (id: string) =>
      people.find((p) => p.id === id) ??
      (() => {
        throw new Error('Missing fixture actor');
      })();
    expect(Math.floor(ageYears(byId('yusuf')))).toBe(34);
    expect(Math.floor(ageYears(byId('yusuf-usta')))).toBe(74);
    expect(Math.floor(ageYears(byId('meryem-visitor')))).toBe(19);
    expect(spousesOf(byId('yusuf'))).toContain('zehra');
    expect(byId('zehra').family?.pregnancy?.fatherId).toBe('yusuf');
    expect(spousesOf(byId('samira'))).not.toContain('yusuf');
    expect(
      byId('meryem-visitor').social.relationships.find((r) => r.otherId === 'yusuf-usta')?.roles,
    ).toContain('grandparent');
  });
  it('does not give the Christian water steward Muslim obligations or marry visitors', () => {
    const { people } = foundValley(42, 0);
    const danyal =
      people.find((p) => p.id === 'danyal') ??
      (() => {
        throw new Error('Missing fixture actor');
      })();
    expect(danyal.conscience.norms.some((n) => n.normId === 'salah')).toBe(false);
    expect(spousesOf(danyal)).toEqual([]);
  });
});

import { DAY } from '../src/sim/calendar.ts';
import { act, fingerprint, load, newGame, replay, save, step } from '../src/sim/game.ts';

it('reveals a volunteered fact only on a later visit and replays it', () => {
  const g = newGame(42);
  expect(g.valley.notes.some((n) => n.text.includes('wooden token'))).toBe(false);
  expect(act(g, { verb: 'visit', house: 'coban' })).toBe(true);
  expect(g.valley.notes.some((n) => n.text.includes('wooden token'))).toBe(false);
  step(g, DAY + 8 * 60);
  expect(act(g, { verb: 'visit', house: 'coban' })).toBe(true);
  expect(g.valley.notes.some((n) => n.words?.includes('wooden token'))).toBe(true);
  const expected = fingerprint(g.valley);
  expect(fingerprint(replay(42, g.inputs, g.valley.minute).valley)).toBe(expected);
});

it('lets each visitor choose a disclosure on separate return visits', () => {
  const g = newGame(42);
  for (let day = 0; day < 4; day++) {
    if (day) step(g, day * DAY + 8 * 60);
    expect(act(g, { verb: 'visit', house: 'guests' })).toBe(true);
  }
  for (const id of ['yusuf-usta', 'meryem-visitor', 'samira']) {
    expect(g.valley.flags.beats).toContain(`cast-disclosed:${id}`);
  }
  step(g, 4 * DAY + 8 * 60);
  act(g, { verb: 'visit', house: 'water-guest' });
  step(g, 5 * DAY + 8 * 60);
  act(g, { verb: 'visit', house: 'water-guest' });
  expect(g.valley.flags.beats).toContain('cast-disclosed:danyal');
});

it('refuses an old edition and preserves a current saved discovery', () => {
  const g = newGame(42);
  act(g, { verb: 'visit', house: 'coban' });
  step(g, DAY + 8 * 60);
  act(g, { verb: 'visit', house: 'coban' });
  const saved = save(g);
  expect(() => load({ ...saved, version: '0.1.0' })).toThrow('start fresh');
  expect(fingerprint(load(saved).valley)).toBe(saved.fingerprint);
});

import { laneLife, newValley } from '../src/sim/valley.ts';

it('never assigns incidental Muslim prayer prose to Christian Danyal', () => {
  const s = newValley(42);
  const danyal = s.people.find((p) => p.id === 'danyal');
  const house = s.households.find((h) => h.members.includes('danyal'));
  if (!danyal || !house) throw new Error('missing Danyal lodging');
  s.households = [{ ...house, members: ['danyal'], store: 100 }];
  s.people = [danyal];
  const lines: string[] = [];
  for (let day = 0; day < 365; day++) {
    s.notes = [];
    laneLife(s, day);
    lines.push(...s.notes.map((n) => n.text));
  }
  expect(lines.length).toBeGreaterThan(0);
  expect(lines.some((line) => line.includes('mosque'))).toBe(false);
});

it('opens visits and insisting from an actual deferred reply, regardless of prose case', () => {
  const g = newGame(42, undefined, false, true, 'valley-public-2026-10');
  expect(
    act(g, {
      verb: 'call',
      job: 'reap-agha',
      houses: ['kavak', 'ak', 'coban', 'dere', 'kara', 'demirci', 'kuyucu', 'tepe'],
    }),
  ).toBe(true);
  step(g, 720);
  expect(Object.values(g.valley.asks[0]?.replies ?? {}).some((r) => r.verdict === 'deferred')).toBe(true);
  expect(g.valley.flags.verbs).toContain('visit');
  expect(g.valley.flags.verbs).toContain('insist');
});

it('blocks disclosure during a levy but permits it after that levy expires', () => {
  const g = newGame(42);
  act(g, { verb: 'visit', house: 'coban' });
  step(g, DAY + 8 * 60);
  act(g, { verb: 'call', job: 'reap-agha', houses: ['coban'] });
  act(g, { verb: 'visit', house: 'coban' });
  expect(g.valley.flags.beats).not.toContain('cast-disclosed:yusuf');
  step(g, 8 * DAY + 8 * 60);
  act(g, { verb: 'visit', house: 'coban' });
  expect(g.valley.flags.beats).toContain('cast-disclosed:yusuf');
});

it('keeps a foreign file session without a Shelf, ownership publication or new game', async () => {
  const { CastSession } = await import('../src/ui/cast-session.ts');
  const session = new CastSession(
    {
      setPersonaRecording() {},
      allowPersonaRecording() {},
      personaRecordingAllowed: true,
      build: () => ({}),
    },
    null,
  );
  const game = newGame(7, undefined, false, true, 'valley-public-2026-10');
  await session.loaded(game, undefined, true, { castHeads: {}, castSources: {} });
  expect(session.fileOrigin).toBe(true);
  expect(session.heads).toEqual({});
  await expect(session.fresh(7)).rejects.toThrow('file session');
  await session.checkpoint(true);
  await session.alternative('hf.cast.yusuf.well');
  expect(session.heads).toEqual({});
  expect(session.exportRun(save(game)).state).toEqual(save(game).state);
  expect(session.exportRun(save(game)).castSourceRefs).toEqual({});
}, 60_000);
