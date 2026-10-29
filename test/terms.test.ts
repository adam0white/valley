import { expect, it } from 'vitest';
import { act, restoreState, stateJson } from '../src/sim/game.ts';
import { exportRun, personRun } from '../src/sim/hf.ts';
import { helpOf, helpTargets, TERMS } from '../src/sim/terms.ts';
import { advanceTo, houseOf, makeWorld } from '../src/sim/valley.ts';
import { hostFixture } from './hf-host-fixture.ts';
import { required } from './required.ts';

/** An authored two-person boundary fixture, not a recorded whole Valley term.
 * The room, visit, weather record and initial grain are host authoring.
 * HF owns every subsequent attention, decision, activity and body consequence.
 */
function termsScene(person = 'zehra', motivated = true) {
  const at = 870;
  const f = hostFixture(at, person, undefined, (p) => {
    p.skills.farming = { level: 0.7, practice: 0, lastPracticed: at };
    if (motivated)
      p.agenda.goals.push({
        id: 'help-by-agreement',
        label: 'help after agreeing the food terms',
        serves: ['meaning'],
        advancedBy: [
          { action: 'terms-help-assent', amount: 0.4 },
          { action: 'reap-agha', amount: 0.6 },
        ],
        importance: 1,
        progress: 0,
        status: 'active',
        adoptedAt: at,
      });
  });
  const h = required(houseOf(f.s, 'coban'));
  h.field.standing = 0;
  h.members = [person];
  f.s.kahyaState.visit = { house: 'coban', arrive: 860, leave: 960, back: 980 };
  f.s.kahyaState.place = 'house:coban';
  f.c.places = { kahya: 'house:coban', [person]: 'house:coban' };
  advanceTo(f.s, 871);
  expect(act(f.game, { verb: 'call', job: 'reap-agha', houses: ['coban'] })).toBe(true);
  const target = required(helpTargets(f.s).find((t) => t.person === person));
  const before = f.s.agha.granary;
  expect(act(f.game, target)).toBe(true);
  expect(f.s.agha.granary).toBeCloseTo(before - TERMS.max);
  return f;
}

it('reserves real grain and requires actual voluntary assent before any useful paid work', () => {
  const f = termsScene();
  advanceTo(f.s, 930);
  const h = required(helpOf(f.s));
  expect(h.status).toBe('agreed');
  expect(h.speech?.activity.action).toBe('terms-help-assent');
  expect(h.speech?.reason).toBe('ended');
  expect(h.answer?.words).toContain('my own work only');
  expect(h.earned).toBeGreaterThanOrEqual(0);
  advanceTo(f.s, 1200);
  const work = required(helpOf(f.s));
  expect(work.work.length).toBeGreaterThan(0);
  expect(work.earned).toBeGreaterThan(0);
  expect(work.held + work.returned + work.cargo + work.delivered).toBeCloseTo(TERMS.max);
  f.verify();
});

function advanceByQuantum(s: ReturnType<typeof termsScene>['s'], to: number) {
  while (s.minute < to) advanceTo(s, Math.min(to, s.minute + 30));
}
it('pays only useful interrupted work once and refunds the unearned reservation', () => {
  const f = termsScene();
  advanceTo(f.s, 930);
  const before = required(helpOf(f.s));
  while (f.s.minute < 1200 && f.person.activity?.affordanceId !== `terms-help-work:${before.id}`)
    advanceTo(f.s, f.s.minute + 30);
  expect(f.person.activity?.affordanceId).toBe(`terms-help-work:${before.id}`);
  advanceTo(f.s, f.s.minute + 30);
  const activeId = required(f.c.active[f.person.id]).id;
  expect(act(f.game, { verb: 'help-end', contract: before.id })).toBe(true);
  advanceTo(f.s, f.s.minute + 30);
  const h = required(helpOf(f.s));
  expect(h.work).toHaveLength(1);
  expect(h.work[0]?.reason).toBe('interrupted');
  expect(h.minutes).toBeGreaterThan(0);
  expect(h.minutes).toBeLessThan(120);
  expect(h.earned).toBeGreaterThan(0);
  expect(h.earned + h.returned).toBeCloseTo(TERMS.max);
  const archive = exportRun(required(personRun(f.person)));
  const inputs = archive.history.flatMap((entry) => entry.inputs);
  const interruption = required(
    inputs.find((entry) => entry.kind === 'activity.interrupted' && entry.payload.activityId === activeId),
  );
  expect(interruption.at - Math.round(required(h.stopAt) * 60000)).toBe(1);
  expect(
    inputs.find(
      (entry) =>
        entry.kind === 'action.resolved' &&
        entry.payload.stage === 'interrupt' &&
        entry.payload.activityId === activeId,
    ),
  ).toMatchObject({ payload: { outcome: { status: 'interrupted', end: interruption.at } } });
  const crop = f.s.agha.reaped,
    earned = h.earned;
  const receipt = required(h.work[0]);
  makeWorld(f.s).resolve(f.person, receipt.activity, receipt.reason);
  expect(f.s.agha.reaped).toBe(crop);
  expect(required(helpOf(f.s)).earned).toBe(earned);
  expect(exportRun(required(personRun(f.person)))).toEqual(archive);
  f.verify();
});

it('continues a real earned cargo through native restore and deposits only after physical carriage', () => {
  const f = termsScene();
  advanceByQuantum(f.s, 1200);
  expect(required(helpOf(f.s)).earned).toBeCloseTo(TERMS.max);
  const source = required(helpOf(f.s)).answer;
  const words = required(source);
  const body = exportRun(required(personRun(f.person)));
  expect(act(f.game, { verb: 'keep-words', note: words.id })).toBe(true);
  expect(act(f.game, { verb: 'keep-words', note: words.id })).toBe(false);
  expect(exportRun(required(personRun(f.person)))).toEqual(body);
  advanceByQuantum(f.s, TERMS.deliveryFrom);
  const id = required(helpOf(f.s)).id;
  expect(act(f.game, { verb: 'help-deliver', contract: id })).toBe(true);
  expect(act(f.game, { verb: 'visit', house: 'kara' })).toBe(false);
  expect(act(f.game, { verb: 'pass', choice: 'depart' })).toBe(false);
  let cargoAt: number | undefined;
  for (let t = f.s.minute + 30; t < TERMS.deliveryDue; t += 30) {
    advanceTo(f.s, t);
    const h = required(helpOf(f.s));
    expect(h.held + h.cargo + h.delivered + h.returned).toBeCloseTo(TERMS.max);
    if (h.cargo > 0) {
      cargoAt = t;
      break;
    }
  }
  expect(cargoAt).toBeDefined();
  expect(required(helpOf(f.s)).delivered).toBe(0);
  const captured = stateJson(f.s),
    restored = restoreState(captured);
  expect(stateJson(restored)).toEqual(captured);
  const game = { valley: restored, inputs: [] };
  expect(act(game, { verb: 'help-return', contract: id })).toBe(true);
  advanceByQuantum(restored, TERMS.deliveryDue);
  expect(required(helpOf(restored)).delivered).toBe(0);
  expect(required(helpOf(restored)).held).toBeCloseTo(TERMS.max);
  advanceByQuantum(f.s, TERMS.deliveryDue);
  const completed = required(helpOf(f.s));
  expect(completed.delivered).toBeCloseTo(TERMS.max);
  expect(completed.delivery?.phase).toBe('home');
  expect(completed.depositedAt).toBeGreaterThan(required(cargoAt));
  expect(completed.held + completed.cargo + completed.delivered + completed.returned).toBeCloseTo(TERMS.max);
  expect(f.s.receivedTerms?.keptWords[0]?.original).toEqual(words);
  f.verify();
}, 120000);
