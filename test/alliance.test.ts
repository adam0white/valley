import { inspect } from '@adam0white/human-framework';
import { expect, it } from 'vitest';
import { brokerReady, brokerUnavailable } from '../src/sim/brokering.ts';
import { DAY, HOUR } from '../src/sim/calendar.ts';
import { act, compactRun, load, newGame, save, stateJson, step } from '../src/sim/game.ts';
import { courtshipStage, finish, type Person, personRun } from '../src/sim/hf.ts';
import { makeWorld, personOf, underSeal } from '../src/sim/valley.ts';
import { callUnavailable, currentJob, loanReturnWords } from '../src/ui/presentation.ts';
import { required } from './required.ts';

function meetings(person: Person, otherId = 'esma'): number {
  const result = inspect(required(personRun(person)), {
    perspective: { kind: 'person', observer: person.id },
    people: [person.id],
    select: [],
    lifecycle: {
      kind: 'person',
      query: { kind: 'held-partnering', person: person.id, other: { kind: 'entity', id: otherId } },
    },
  });
  if (!result.ok) throw new Error(result.error.message);
  const value = result.value.lifecycle;
  if (!value || !('courtships' in value)) throw new Error('Missing held courtship evidence');
  return value.courtships.find((c) => c.withId === otherId)?.meetings ?? 0;
}

// Catch a host that reuses one attendance as continuing consent or makes repeat meetings free.
it('costs repeated voluntary meetings and keeps the entire native history without promising marriage', () => {
  const g = newGame(7, undefined, false, true, 'valley-alliance-2026-10');
  expect(act(g, { verb: 'introduce' })).toBe(true);
  step(g, 3 * DAY);
  const a = personOf(g.valley, 'ali');
  if (!a) throw Error('Missing adult');
  const before = meetings(a);
  expect(act(g, { verb: 'turn-away', knock: 'k10' })).toBe(true);
  const grain = g.valley.agha.granary;
  expect(act(g, { verb: 'broker', choice: 'meeting' })).toBe(true);
  expect(g.valley.agha.granary).toBe(grain - 1);
  expect(act(g, { verb: 'broker', choice: 'meeting' })).toBe(false);
  step(g, 6 * DAY);
  expect(meetings(a)).toBeGreaterThan(before);
  expect(courtshipStage(a, 'esma')).toBe('courting');
  expect(act(g, { verb: 'broker', choice: 'ceremony' })).toBe(false);
  expect(stateJson(load(save(g)).valley)).toEqual(stateJson(g.valley));
  expect(stateJson(load(compactRun(g)).valley)).toEqual(stateJson(g.valley));
});

// Catch stone minted by a promise, unpaid road work, repeated collection, or reservation leakage.
it('reserves finite stone for a costed road agreement and breaches if the work is withdrawn', () => {
  const g = newGame(7, undefined, false, true, 'valley-alliance-2026-10');
  expect(act(g, { verb: 'alliance', choice: 'accept' })).toBe(false);
  expect(act(g, { verb: 'pass', choice: 'depart' })).toBe(true);
  step(g, 420 + 8 * HOUR);
  expect(act(g, { verb: 'alliance', choice: 'accept' })).toBe(true);
  expect(g.valley.pass?.stock).toBe(2);
  expect(g.valley.pass?.grainReceived).toBe(6);
  expect(g.valley.pass?.journey?.grain).toBe(0);
  expect(g.valley.pass?.journey?.cargo).toBe(0);
  expect(act(g, { verb: 'alliance', choice: 'collect' })).toBe(false);
  expect(act(g, { verb: 'alliance', choice: 'withdraw' })).toBe(true);
  expect(g.valley.pass?.stock).toBe(3);
  expect(g.valley.pass?.grainReceived).toBe(6);
  expect(act(g, { verb: 'alliance', choice: 'accept' })).toBe(false);
  step(g, 3 * DAY);
  expect(g.valley.pass?.stone).toBe(0);
  expect(stateJson(load(save(g)).valley)).toEqual(stateJson(g.valley));
  expect(stateJson(load(compactRun(g)).valley)).toEqual(stateJson(g.valley));
});

it('progresses real repeated attendance to independent guardian and adult proposal decisions', () => {
  const g = newGame(7, undefined, false, true, 'valley-alliance-2026-10');
  expect(act(g, { verb: 'introduce' })).toBe(true);
  step(g, 3 * DAY);
  const clear = () => {
    for (const k of g.valley.knocks.filter(
      (k) => !k.answered && k.at <= g.valley.minute && k.until > g.valley.minute,
    ))
      expect(act(g, { verb: 'turn-away', knock: k.id })).toBe(true);
  };
  clear();
  const job = currentJob(g.valley);
  if (job && !callUnavailable(g.valley, job))
    expect(
      act(g, {
        verb: 'call',
        job,
        houses: g.valley.households
          .filter((h) => underSeal(g.valley, h) && h.members.length)
          .map((h) => h.id),
      }),
    ).toBe(true);
  for (let round = 0; round < 60 && !brokerReady(g.valley); round++) {
    clear();
    if (g.valley.flags.verbs.includes('borrow') && !loanReturnWords(g.valley) && g.valley.agha.granary < 10)
      expect(act(g, { verb: 'borrow', kile: 80 })).toBe(true);
    const can = !brokerUnavailable(g.valley, 'meeting');
    if (can) act(g, { verb: 'broker', choice: 'meeting' });
    step(g, g.valley.minute + 2 * DAY + HOUR);
  }
  console.log(
    'marriage readiness',
    JSON.stringify({
      day: g.valley.minute / DAY,
      reason: brokerUnavailable(g.valley, 'meeting'),
      body: g.valley.kahya.body,
      intro: g.valley.introduction,
      phase: g.valley.brokering?.phase,
      grain: g.valley.agha.granary,
      meetings: meetings(required(personOf(g.valley, 'ali'))),
      stage: courtshipStage(required(personOf(g.valley, 'ali')), 'esma', g.valley.minute),
    }),
  );
  expect(brokerReady(g.valley)).toBe(true);
  clear();
  expect(act(g, { verb: 'broker', choice: 'proposal' })).toBe(true);
  const proposalStart = g.valley.minute;
  const interrupted = load(save(g));
  let father = required(personOf(interrupted.valley, 'omer'));
  while (interrupted.valley.minute < proposalStart + 2 * DAY && father.activity?.action !== 'approve-match') {
    step(interrupted, interrupted.valley.minute + 30);
    father = required(personOf(interrupted.valley, 'omer'));
  }
  const approval = required(father.activity);
  expect(approval.action).toBe('approve-match');
  const result = makeWorld(interrupted.valley).resolve(father, approval, 'interrupted');
  finish(father, result);
  expect(interrupted.valley.brokering?.guardian).toBeUndefined();
  expect(interrupted.valley.brokering?.phase).toBe('guardian');
  expect(act(interrupted, { verb: 'broker', choice: 'ceremony' })).toBe(false);
  step(g, proposalStart + 2 * DAY + HOUR);
  const b = g.valley.brokering;
  console.log(
    'proposal outcome',
    JSON.stringify({ phase: b?.phase, guardian: b?.guardian, decisions: b?.decisions }),
  );
  expect(b?.decisions.some((d) => d.person === 'omer' && d.action === 'approve-match')).toBe(true);
  expect(b?.decisions.some((d) => d.person === 'ali' && d.action === 'propose')).toBe(true);
  expect(
    b?.decisions.some(
      (d) => d.person === 'esma' && ['accept-proposal', 'decline-proposal'].includes(d.action),
    ),
  ).toBe(true);
  expect(['engaged', 'refused']).toContain(b?.phase);
  expect(courtshipStage(required(personOf(g.valley, 'ali')), 'esma', g.valley.minute)).not.toBe('married');
  expect(stateJson(load(compactRun(g)).valley)).toEqual(stateJson(g.valley));
  expect(stateJson(load(save(g)).valley)).toEqual(stateJson(g.valley));
  if (b?.phase === 'engaged') {
    clear();
    const before = g.valley.agha.granary;
    expect(act(g, { verb: 'broker', choice: 'ceremony' })).toBe(true);
    expect(g.valley.agha.granary).toBe(before - 7);
    expect(b.giftEscrow).toBe(6);
    expect(act(g, { verb: 'broker', choice: 'ceremony' })).toBe(false);
    const full = load(save(g));
    const compact = load(compactRun(g));
    const until = g.valley.minute + 3 * DAY;
    step(g, until);
    step(full, until);
    step(compact, until);
    console.log('ceremony outcome', JSON.stringify({ phase: b.phase, attendance: b.ceremony, gift: b.gift }));
    expect(['married', 'refused', 'expired']).toContain(b.phase);
    expect(b.giftEscrow).toBe(0);
    if (g.valley.brokering?.phase === 'married') {
      expect(courtshipStage(required(personOf(g.valley, 'ali')), 'esma')).toBe('married');
      expect(courtshipStage(required(personOf(g.valley, 'esma')), 'ali')).toBe('married');
      expect(b.gift?.person).toBe('esma');
      expect(b.gift?.grain).toBe(6);
      expect(Object.keys(b.ceremony).sort()).toEqual(['ali', 'esma', 'omer']);
    } else expect(b.gift).toBeUndefined();
    expect(stateJson(full.valley)).toEqual(stateJson(g.valley));
    expect(stateJson(compact.valley)).toEqual(stateJson(g.valley));
  }
  expect(g.valley.kahya.body.alive).toBe(true);
});

// Catch outright barter bypassing the alliance terms, or the gate disabling reviewed pass barter.
it('keeps pass barter but requires real alliance work and collection for the same quarry stone', () => {
  const pass = newGame(7, undefined, false, true, 'valley-pass-2026-10');
  expect(act(pass, { verb: 'pass', choice: 'depart' })).toBe(true);
  step(pass, 900);
  expect(act(pass, { verb: 'pass', choice: 'buy' })).toBe(true);
  expect(pass.valley.pass?.journey?.grain).toBe(0);
  expect(pass.valley.pass?.journey?.cargo).toBe(1);
  expect(pass.valley.pass?.stock).toBe(2);
  expect(pass.valley.pass?.grainReceived).toBe(6);
  const g = newGame(7, undefined, false, true, 'valley-alliance-2026-10');
  expect(act(g, { verb: 'pass', choice: 'depart' })).toBe(true);
  step(g, 900);
  const beforeBuy = stateJson(g.valley);
  const inputs = g.inputs.length;
  expect(act(g, { verb: 'pass', choice: 'buy' })).toBe(false);
  expect(stateJson(g.valley)).toEqual(beforeBuy);
  expect(g.inputs).toHaveLength(inputs);
  expect(g.valley.pass?.journey?.grain).toBe(6);
  expect(g.valley.pass?.journey?.cargo).toBe(0);
  expect(g.valley.pass?.stock).toBe(3);
  expect(g.valley.pass?.grainReceived).toBe(0);
  expect(act(g, { verb: 'alliance', choice: 'accept' })).toBe(true);
  const breached = load(save(g));
  expect(act(breached, { verb: 'release-cast', person: 'yusuf-usta' })).toBe(true);
  step(breached, 16 * DAY);
  expect(breached.valley.pass?.alliance?.status).toBe('breached');
  expect(breached.valley.pass?.stock).toBe(3);
  expect(breached.valley.pass?.grainReceived).toBe(6);
  expect(stateJson(load(compactRun(breached)).valley)).toEqual(stateJson(breached.valley));
  step(g, 5 * DAY + 420);
  console.log('road outcome', JSON.stringify(g.valley.pass?.alliance));
  expect(g.valley.pass?.alliance?.hours).toBe(12);
  expect(g.valley.pass?.alliance?.work).toHaveLength(6);
  expect(g.valley.pass?.alliance?.work.every((w) => w.to - w.from === 4 * HOUR && w.hours === 2)).toBe(true);
  const expired = load(save(g));
  step(expired, 16 * DAY);
  expect(expired.valley.pass?.alliance?.status).toBe('expired');
  expect(expired.valley.pass?.stock).toBe(3);
  expect(expired.valley.pass?.grainReceived).toBe(6);
  expect(act(g, { verb: 'alliance', choice: 'collect' })).toBe(false);
  for (const k of g.valley.knocks.filter(
    (k) => !k.answered && k.at <= g.valley.minute && k.until > g.valley.minute,
  ))
    expect(act(g, { verb: 'turn-away', knock: k.id })).toBe(true);
  expect(act(g, { verb: 'pass', choice: 'depart' })).toBe(true);
  step(g, g.valley.minute + 8 * HOUR);
  expect(act(g, { verb: 'alliance', choice: 'collect' })).toBe(true);
  expect(act(g, { verb: 'alliance', choice: 'collect' })).toBe(false);
  expect(g.valley.pass?.stone).toBe(0);
  const full = load(save(g));
  const compact = load(compactRun(g));
  step(g, 8 * DAY);
  step(full, 8 * DAY);
  step(compact, 8 * DAY);
  expect(g.valley.pass?.stone).toBe(1);
  expect(g.valley.pass?.alliance?.status).toBe('completed');
  expect(g.valley.pass?.stock).toBe(2);
  expect(stateJson(full.valley)).toEqual(stateJson(g.valley));
  expect(stateJson(compact.valley)).toEqual(stateJson(g.valley));
});
