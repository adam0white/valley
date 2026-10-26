import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { DAY, HOUR, yearOf } from '../src/sim/calendar.ts';
import { act, compactRun, load, newGame, replay, save, stateJson, step } from '../src/sim/game.ts';
import { underSeal } from '../src/sim/valley.ts';
import { callUnavailable, currentJob, loanReturnWords } from '../src/ui/presentation.ts';

it('keeps entire raw old-edition continuations equal to the pre-change source', () => {
  const rows = [
    { rules: undefined, sha: '0078dc96765a69d70ea40a30811126ea5c0067bdc3a22402c7170c89b4433534' },
    {
      rules: 'valley-2026-10' as const,
      sha: '89b4bad4c23fe63376efa572c27cf17265329b586b95dfdfd9d34faaf17395f3',
    },
  ];
  for (const row of rows) {
    const g = replay(
      7,
      [{ at: 420, verb: 'call', job: 'reap-agha', houses: ['kavak', 'coban'], wage: true }],
      4320,
      undefined,
      true,
      row.rules,
    );
    expect(
      createHash('sha256')
        .update(JSON.stringify(stateJson(g.valley)))
        .digest('hex'),
    ).toBe(row.sha);
  }
});

it('visits a real neighbouring quarry, pays for provisions and stone, and returns through normal time', () => {
  const g = newGame(7, undefined, false, true, 'valley-pass-2026-10');
  const start = g.valley.minute;
  expect(act(g, { verb: 'pass', choice: 'depart' })).toBe(true);
  expect(g.valley.agha.granary).toBe(23);
  expect(act(g, { verb: 'pass', choice: 'buy' })).toBe(false);
  expect(act(g, { verb: 'visit', house: 'coban' })).toBe(false);
  const outbound = load(save(g));
  step(g, start + 8 * HOUR);
  step(outbound, start + 8 * HOUR);
  expect(stateJson(outbound.valley)).toEqual(stateJson(g.valley));
  expect(g.valley.notes.some((n) => n.text.includes('Çam quarry'))).toBe(true);
  expect(act(g, { verb: 'pass', choice: 'buy' })).toBe(true);
  expect(act(g, { verb: 'pass', choice: 'buy' })).toBe(false);
  expect(g.valley.agha.granary).toBe(23);
  step(g, start + 2 * DAY);
  expect(g.valley.pass?.stone).toBe(1);
  expect(g.valley.pass?.stock).toBe(2);
  expect(g.valley.pass?.grainReceived).toBe(6);
  expect(g.valley.pass?.journey?.grain).toBe(0);
  expect(g.valley.agha.mill).toBe(0);
  expect(g.valley.people.every((p) => p.now >= 2 * DAY || !p.body.alive)).toBe(true);
  const expected = stateJson(g.valley);
  expect(stateJson(load(save(g)).valley)).toEqual(expected);
  expect(stateJson(load(compactRun(g)).valley)).toEqual(expected);
  // An older passport cannot silently label this new world as its own edition.
  const mislabeled = save(g);
  mislabeled.rules = 'valley-2026-10';
  if (mislabeled.state.edition) mislabeled.state.edition.id = 'valley-2026-10';
  expect(() => load(mislabeled)).toThrow('pass world');
  step(g, 133 * DAY);
  expect(g.valley.agha.missed).toBe(1); // The trip never suspends the first payment deadline.
  expect(g.valley.agha.millOpen).toBe(true);
  expect(act(g, { verb: 'pass', choice: 'deliver' })).toBe(true);
  expect(g.valley.agha.mill).toBe(12);
  expect(act(g, { verb: 'pass', choice: 'deliver' })).toBe(false);
  expect(g.valley.pass?.stone).toBe(0);
  expect(stateJson(load(save(g)).valley)).toEqual(stateJson(g.valley));
  expect(stateJson(load(compactRun(g)).valley)).toEqual(stateJson(g.valley));
});

it('offers a supervised eligible introduction and reports actual choices without inventing a marriage', () => {
  const g = newGame(7, undefined, false, true, 'valley-pass-2026-10');
  expect(act(g, { verb: 'introduce' })).toBe(true);
  expect(act(g, { verb: 'introduce' })).toBe(false);
  step(g, 3 * DAY);
  expect(g.valley.introduction?.choices).toBeDefined();
  expect(Object.keys(g.valley.introduction?.choices ?? {}).length).toBeGreaterThan(0);
  expect(g.valley.introduction?.status).toBe('met');
  for (const id of ['ali', 'esma', 'omer'])
    expect(g.valley.introduction?.choices[id]?.verdict).toBe('assented');
  expect(g.valley.people.find((p) => p.id === 'ali')?.bonds?.courtships[0]?.withId).toBe('esma');
  expect(g.valley.people.find((p) => p.id === 'esma')?.bonds?.courtships[0]?.withId).toBe('ali');
  expect(g.valley.notes.some((n) => /message from Kuyucu|supervised meeting/.test(n.text))).toBe(true);
  const compact = load(compactRun(g));
  const full = load(save(g));
  expect(stateJson(compact.valley)).toEqual(stateJson(g.valley));
  expect(stateJson(full.valley)).toEqual(stateJson(g.valley));
  step(g, 4 * DAY);
  step(compact, 4 * DAY);
  step(full, 4 * DAY);
  expect(stateJson(compact.valley)).toEqual(stateJson(g.valley));
  expect(stateJson(full.valley)).toEqual(stateJson(g.valley));
});

it('receives a real voluntary sack against a third-year shortfall using only ordinary inputs', () => {
  const g = newGame(42, undefined, false, true, 'valley-2026-10');
  for (let day = 0; day <= 760; day++) {
    step(g, day * DAY + 8 * HOUR);
    const s = g.valley;
    const job = currentJob(s);
    const houses = s.households.filter((h) => underSeal(s, h) && h.members.length).map((h) => h.id);
    if (s.minute === 500160) expect(act(g, { verb: 'turn-away', knock: 'k148' })).toBe(true);
    const ordinary = () => {
      expect(s.knocks.filter((k) => !k.answered && k.at <= s.minute && k.until > s.minute)).toEqual([]);
      expect(
        s.edition?.decisions?.filter((d) => !d.answered && d.from <= s.minute && d.until > s.minute) ?? [],
      ).toEqual([]);
    };
    if (job && !callUnavailable(s, job)) {
      ordinary();
      if (job === 'build-mill') expect(s.agha.granary).toBeGreaterThan(0);
      act(g, {
        verb: 'call',
        job,
        houses,
        wage: job === 'build-mill' || (job === 'reap-agha' && yearOf(day) > 1),
      });
    }
    if (s.flags.verbs.includes('borrow') && !loanReturnWords(s) && s.agha.granary < 50) {
      ordinary();
      act(g, { verb: 'borrow', kile: 80 });
    }
    if (day === 759) {
      ordinary();
      expect(act(g, { verb: 'visit', house: 'sari' })).toBe(true);
    }
  }
  const s = g.valley;
  expect(s.flags.ended).toBeUndefined();
  const donor = s.households.find((h) => h.id === 'sari');
  if (!donor) throw new Error('Missing actual household');
  const grain = s.agha.granary;
  const store = donor.store;
  const due = s.agha.due;
  expect(s.kahyaState.seen.sari).toBeLessThan(s.minute);
  expect(due - grain).toBeCloseTo(248.5553086088396);
  expect(store).toBeCloseTo(59.03891608446829);
  expect(s.knocks.some((k) => !k.answered && k.at <= s.minute && k.until > s.minute)).toBe(false);
  expect(
    s.edition?.decisions?.some((d) => !d.answered && d.from <= s.minute && d.until > s.minute) ?? false,
  ).toBe(false);
  expect(act(g, { verb: 'contribute', house: donor.id })).toBe(true);
  step(g, s.minute + 4 * HOUR);
  expect(s.edition?.requests?.find((r) => r.id === 'early-sack:sari:3')?.status).toBe('done');
  expect(s.agha.granary).toBe(grain + 6);
  expect(donor.store).toBeCloseTo(store - 6);
  expect(s.agha.due).toBe(due);
  expect(s.agha.due - s.agha.granary).toBeCloseTo(242.5553086088396);
  expect(donor.paid).toBe(15); // The extra sack never erases the ordinary share.
});
