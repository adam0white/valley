import { begin, decide } from '@adam0white/human-framework';
import { expect, it } from 'vitest';
import { DAY, HOUR } from '../src/sim/calendar.ts';
import { chooseTerm, millPay, requestContribution, talkAtHearth, termDay } from '../src/sim/edition.ts';
import { act, compactRun, fingerprint, load, newGame, save, step } from '../src/sim/game.ts';
import { makeWorld, personOf } from '../src/sim/valley.ts';
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
  const restored = load(save(g));
  expect(millPay(restored.valley, 'yusuf', 'one', 2, true)).toBe(0);
});
it('contribution is an optional HF action, transfers only on completion and cannot duplicate', () => {
  const s = fresh().valley;
  const h = required(s.households.find((h) => h.id === 'coban'));
  h.store = 200;
  required(s.edition).forecast = 1;
  expect(requestContribution(s, h.id)).toBe(true);
  expect(requestContribution(s, h.id)).toBe(false);
  const p = required(personOf(s, required(h.members[0])));
  p.now = s.minute;
  const world = makeWorld(s);
  const offer = required(world.affordancesFor(p).find((a) => a.action === 'early-sack'));
  expect(offer).toBeDefined();
  const total = h.store + s.agha.granary;
  const activity = required(begin(p, offer, decide(p, [offer])));
  expect(activity).not.toBeNull();
  required(world.resolve)(p, activity, 'interrupted');
  expect(h.store + s.agha.granary).toBeCloseTo(total);
  const before = s.agha.granary;
  required(world.resolve)(p, activity, 'ended');
  required(world.resolve)(p, activity, 'ended');
  expect(s.agha.granary - before).toBe(6);
  expect(h.store + s.agha.granary).toBeCloseTo(total);
});
it('creates a tie-grounded winter request and a two-day third-year levy, only in the new edition', () => {
  const s = fresh().valley;
  s.minute = 150 * DAY;
  required(s.households.find((h) => h.id === 'coban')).store = 0;
  required(s.households.find((h) => h.id === 'kavak')).store = 200;
  const petitioner = required(personOf(s, 'yusuf'));
  petitioner.now = s.minute;
  const ask = {
    id: 'ask-kahya',
    action: 'ask-kahya',
    label: 'ask for food',
    duration: 60,
    effort: 0.1,
    advertises: {},
  };
  const asking = required(begin(petitioner, ask, decide(petitioner, [ask])));
  required(makeWorld(s).resolve)(petitioner, asking, 'ended');
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
it('routes actual mill completion through the world, paying only the remaining useful work', () => {
  const s = fresh().valley;
  const p = required(personOf(s, 'yusuf'));
  s.agha.millOpen = true;
  s.agha.mill = 599.95;
  expect(
    act({ valley: s, inputs: [] }, { verb: 'call', job: 'build-mill', houses: ['coban'], wage: true }),
  ).toBe(true);
  const world = makeWorld(s);
  const offer = {
    id: 'build-mill',
    action: 'build-mill',
    label: 'carry stone',
    duration: 120,
    effort: 0.8,
    advertises: {},
  };
  const activity = required(begin(p, offer, decide(p, [offer])));
  const before = s.agha.granary;
  required(world.resolve)(p, activity, 'ended');
  expect(s.agha.mill).toBe(600);
  expect(before - s.agha.granary).toBeCloseTo(0.0075);
  required(world.resolve)(p, activity, 'ended');
  expect(before - s.agha.granary).toBeCloseTo(0.0075);
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
it('a mediated winter loan creates debt only after a real completed sack transfer', () => {
  const s = fresh().valley;
  s.minute = 150 * DAY;
  const poor = required(s.households.find((h) => h.id === 'coban'));
  const donor = required(s.households.find((h) => h.id === 'kavak'));
  poor.store = 0;
  donor.store = 200;
  const petitioner = required(personOf(s, 'yusuf'));
  petitioner.now = s.minute;
  const knock = {
    id: 'ask-kahya',
    action: 'ask-kahya',
    label: 'ask for food',
    duration: 60,
    effort: 0.1,
    advertises: {},
  };
  required(makeWorld(s).resolve)(
    petitioner,
    required(begin(petitioner, knock, decide(petitioner, [knock]))),
    'ended',
  );
  termDay(s, 150);
  const decision = required(s.edition?.decisions?.find((d) => d.kind === 'winter'));
  expect(chooseTerm(s, decision.id, 'neighbour')).toBe(true);
  expect(s.edition?.debts).toBeUndefined();
  const lender = required(personOf(s, 'osman'));
  lender.now = s.minute + 10 * HOUR;
  const world = makeWorld(s);
  const offer = required(world.affordancesFor(lender).find((a) => a.action === 'neighbour-loan'));
  const activity = required(begin(lender, offer, decide(lender, [offer])));
  required(world.resolve)(lender, activity, 'interrupted');
  expect(poor.store).toBe(0);
  expect(s.edition?.debts).toBeUndefined();
  required(world.resolve)(lender, activity, 'ended');
  expect(poor.store).toBe(6);
  expect(donor.store).toBe(194);
  expect(s.edition?.debts?.map((d) => ({ from: d.from, to: d.to, amount: d.amount, paid: d.paid }))).toEqual([
    { from: 'coban', to: 'kavak', amount: 6, paid: false },
  ]);
});
it('accepts an on-time levy but charges one late final shift exactly once at completion', () => {
  for (const late of [false, true]) {
    const s = fresh().valley;
    s.minute = 730 * DAY + 10 * HOUR;
    termDay(s, 730);
    const levy = required(s.edition?.decisions?.find((d) => d.kind === 'levy'));
    expect(chooseTerm(s, levy.id, 'ask:kavak')).toBe(true);
    const p = required(personOf(s, 'osman'));
    const world = makeWorld(s);
    const before = s.agha.due;
    let last: ReturnType<typeof begin> = null;
    for (const start of [
      736 * DAY + 8 * HOUR,
      736 * DAY + 10 * HOUR,
      737 * DAY + 6 * HOUR,
      737 * DAY + (late ? 9 : 8) * HOUR,
    ]) {
      p.now = start;
      const offer = required(world.affordancesFor(p).find((a) => a.action === 'levy-service'));
      last = begin(p, offer, decide(p, [offer]));
      const activity = required(last);
      p.now = activity.endsAt;
      s.minute = p.now;
      required(world.resolve)(p, activity, 'ended');
    }
    required(world.resolve)(p, required(last), 'ended');
    expect(s.agha.due - before).toBe(late ? 12 : 0);
    termDay(s, 738);
    expect(s.agha.due - before).toBe(late ? 12 : 0);
    expect(s.edition?.requests?.find((r) => r.action === 'levy-service')?.status).toBe(
      late ? 'expired' : 'done',
    );
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
