import { expect, it } from 'vitest';
import { DAY, HOUR } from '../src/sim/calendar.ts';
import { chooseTerm, millPay, requestContribution, talkAtHearth, termDay } from '../src/sim/edition.ts';
import {
  act,
  compactRun,
  fingerprint,
  load,
  newGame,
  restoreState,
  stateJson,
  step,
} from '../src/sim/game.ts';
import type { Activity } from '../src/sim/hf.ts';
import { makeWorld } from '../src/sim/valley.ts';
import { hostFixture } from './hf-host-fixture.ts';
import { required } from './required.ts';

const fresh = () => newGame(7, undefined, false, true, 'valley-2026-10');
it('pays completed mill work from real grain once, with no pay for unfinished work or old runs', () => {
  const g = fresh();
  const s = g.valley;
  const h = required(s.households.find((h) => h.id === 'coban'));
  const before = h.store;
  s.agha.granary = 0.2;
  expect(millPay(s, 'yusuf', 'one', 2, false)).toBe(0);
  expect(millPay(s, 'yusuf', 'one', 2, true)).toBeCloseTo(0.2);
  expect(millPay(s, 'yusuf', 'one', 2, true)).toBe(0);
  expect(h.store - before).toBeCloseTo(0.2);
  expect(s.agha.granary).toBe(0);
  expect(millPay(newGame(7).valley, 'yusuf', 'old', 2, true)).toBe(0);
  // Host receipt serialization unit: these authored mutations are not an input replay.
  const restored = restoreState(stateJson(s));
  expect(millPay(restored, 'yusuf', 'one', 2, true)).toBe(0);
});
it('an authored host fixture completes a voluntary contribution through HF once', () => {
  const f = hostFixture(600, 'osman', 'early-sack');
  const h = required(f.s.households.find((h) => h.id === 'kavak'));
  h.store = 400;
  h.field.standing = 0;
  required(f.s.edition).forecast = 1;
  expect(requestContribution(f.s, h.id)).toBe(true);
  expect(requestContribution(f.s, h.id)).toBe(false);
  const before = f.s.agha.granary;
  f.advance(601);
  expect(f.s.agha.granary).toBe(before);
  f.advance(720);
  expect(f.s.edition?.requests?.[0]?.status).toBe('done');
  expect(required(f.s.households.find((h) => h.id === 'kavak')).store).toBe(394);
  expect(f.s.agha.granary - before).toBe(6);
  const receipt = required(f.c.completed?.find((r) => r.activity.action === 'early-sack'));
  required(makeWorld(f.s).resolve)(f.person, receipt.activity, 'ended');
  expect(f.s.agha.granary - before).toBe(6);
  expect(required(f.s.households.find((h) => h.id === 'kavak')).store).toBe(394);
  f.verify();
});
it('host policy creates a tie-grounded winter request and a two-day third-year levy, only in the new edition', () => {
  const s = fresh().valley;
  s.minute = 150 * DAY;
  required(s.households.find((h) => h.id === 'coban')).store = 0;
  required(s.households.find((h) => h.id === 'kavak')).store = 200;
  // Structural host policy fixture: an existing recorded petition, not an HF action claim.
  s.knocks.push({
    id: 'fixture-petition',
    at: s.minute,
    until: s.minute + 2 * DAY,
    personId: 'yusuf',
    house: 'coban',
    what: 'grain',
    words: 'A recorded request for grain.',
  });
  termDay(s, 150);
  expect(s.edition?.decisions?.some((d) => d.kind === 'winter' && d.other)).toBe(true);
  s.minute = 2 * 365 * DAY;
  termDay(s, 730);
  const levy = required(required(required(s.edition).decisions).find((d) => d.kind === 'levy'));
  expect(levy).toBeDefined();
  const before = s.agha.granary;
  expect(chooseTerm(s, levy.id, 'grain')).toBe(true);
  expect(s.agha.granary).toBe(before - 12);
  expect(chooseTerm(s, levy.id, 'grain')).toBe(false);
  const old = newGame(7).valley;
  termDay(old, 730);
  expect(old.edition).toBeUndefined();
});
it('keeps hidden grain conserved and an inspection choice cannot be collected twice', () => {
  const s = fresh().valley;
  const before = s.agha.granary;
  expect(chooseTerm(s, 'reserve', 'hide')).toBe(true);
  expect(s.agha.granary).toBe(before - 6);
  s.minute = 45 * DAY;
  termDay(s, 45);
  const inspect = required(required(required(s.edition).decisions).find((d) => d.kind === 'inspection'));
  expect(chooseTerm(s, inspect.id, 'return')).toBe(true);
  expect(chooseTerm(s, inspect.id, 'return')).toBe(false);
  expect(s.agha.granary).toBe(before);
  expect(required(s.edition).reserve).toBe(0);
});
it('hearth topics require the attended visit and use only heard records', () => {
  const g = fresh();
  expect(talkAtHearth(g.valley, 'coban', 'grievance')).toBe(false);
  act(g, { verb: 'visit', house: 'coban' });
  step(g, HOUR * 8);
  expect(talkAtHearth(g.valley, 'dere', 'person')).toBe(false);
  expect(talkAtHearth(g.valley, 'coban', 'grievance')).toBe(true);
  expect(talkAtHearth(g.valley, 'coban', 'grievance')).toBe(false);
});
it('replays new host inputs exactly without altering legacy exports', () => {
  const g = fresh();
  expect(act(g, { verb: 'term-choice', id: 'reserve', choice: 'hide' })).toBe(true);
  step(g, DAY);
  expect(fingerprint(load(compactRun(g)).valley)).toBe(fingerprint(g.valley));
});
it('an authored host fixture pays only remaining useful mill work through actual completion', () => {
  const f = hostFixture(600, 'yusuf', 'build-mill');
  f.s.agha.millOpen = true;
  f.s.agha.mill = 599.95;
  expect(
    act({ valley: f.s, inputs: [] }, { verb: 'call', job: 'build-mill', houses: ['coban'], wage: true }),
  ).toBe(true);
  const before = f.s.agha.granary;
  f.advance(900);
  expect(f.s.agha.mill).toBe(600);
  expect(before - f.s.agha.granary).toBeCloseTo(0.0075);
  const receipt = required(f.c.completed?.find((r) => r.activity.action === 'build-mill'));
  required(makeWorld(f.s).resolve)(f.person, receipt.activity, 'ended');
  expect(before - f.s.agha.granary).toBeCloseTo(0.0075);
  f.verify();
});
it('an unanswered levy has a stated cost exactly once, and interrupted service does not satisfy it', () => {
  const s = fresh().valley;
  s.minute = 730 * DAY;
  termDay(s, 730);
  const due = s.agha.due;
  s.minute += 8 * DAY;
  termDay(s, 738);
  termDay(s, 738);
  expect(s.agha.due).toBe(due + 12);
  expect(s.agha.arrears).toBe(12);
});
it('an authored winter loan creates debt only after a real completed sack transfer', () => {
  const f = hostFixture(150 * DAY + 10 * HOUR, 'osman', 'neighbour-loan');
  const s = f.s;
  required(s.households.find((h) => h.id === 'coban')).store = 0;
  const donor = required(s.households.find((h) => h.id === 'kavak'));
  donor.store = 400;
  donor.field.standing = 0;
  // Existing host petition decision is an authored policy precondition; HF still chooses carriage.
  required(s.edition).decisions = [
    {
      id: 'fixture-winter',
      kind: 'winter',
      house: 'coban',
      other: 'kavak',
      text: 'An existing mediated winter petition.',
      from: s.minute,
      until: s.minute + DAY,
    },
  ];
  expect(chooseTerm(s, 'fixture-winter', 'neighbour')).toBe(true);
  expect(s.edition?.debts).toBeUndefined();
  f.advance(s.minute + 1);
  expect(s.edition?.debts).toBeUndefined();
  f.advance(150 * DAY + 14 * HOUR);
  expect(required(s.households.find((h) => h.id === 'coban')).store).toBe(6);
  expect(required(s.households.find((h) => h.id === 'kavak')).store).toBe(394);
  expect(s.edition?.debts?.map((d) => ({ from: d.from, to: d.to, amount: d.amount, paid: d.paid }))).toEqual([
    { from: 'coban', to: 'kavak', amount: 6, paid: false },
  ]);
  const receipt = required(f.c.completed?.find((r) => r.activity.action === 'neighbour-loan'));
  required(makeWorld(s).resolve)(f.person, receipt.activity, 'ended');
  expect(s.edition?.debts).toHaveLength(1);
  f.verify();
});
it('host levy policy accepts an on-time final shift and charges one late completion exactly once', () => {
  for (const late of [false, true]) {
    const f = hostFixture(737 * DAY + (late ? 11 : 10) * HOUR, 'osman');
    const s = f.s;
    const until = 737 * DAY + 10 * HOUR;
    // Structural negative/boundary fixture: prior service is authored host evidence.
    // This is not a claim that HF chose four shifts in a public playthrough.
    required(s.edition).requests = [
      {
        id: 'fixture-levy',
        person: 'osman',
        house: 'kavak',
        action: 'levy-service',
        from: 730 * DAY,
        until,
        status: 'working',
        service: { '736': 4, '737': 2 },
      },
    ];
    const activity = {
      action: 'levy-service',
      affordanceId: 'fixture-levy',
      startedAt: s.minute - 2 * HOUR,
      endsAt: s.minute,
    } as Activity;
    const before = s.agha.due;
    required(makeWorld(s).resolve)(f.person, activity, 'interrupted');
    expect(s.edition?.requests?.[0]?.service?.['737']).toBe(2);
    required(makeWorld(s).resolve)(f.person, activity, 'ended');
    required(makeWorld(s).resolve)(f.person, activity, 'ended');
    expect(s.agha.due - before).toBe(late ? 12 : 0);
    s.minute = 738 * DAY;
    termDay(s, 738);
    expect(s.agha.due - before).toBe(late ? 12 : 0);
    expect(s.edition?.requests?.[0]?.status).toBe(late ? 'expired' : 'done');
  }
});
it('inspects grain hidden after the old inspection date across a year boundary', () => {
  const s = fresh().valley;
  s.minute = 46 * DAY;
  const total = s.agha.granary;
  expect(chooseTerm(s, 'reserve', 'hide')).toBe(true);
  for (let day = 47; day <= 420; day++) {
    s.minute = day * DAY;
    termDay(s, day);
  }
  expect(s.edition?.decisions?.some((d) => d.kind === 'inspection')).toBe(true);
  expect((s.edition?.reserve ?? 0) + s.agha.granary).toBe(total);
  expect(s.edition?.decisions?.filter((d) => d.kind === 'inspection')).toHaveLength(1);
});
