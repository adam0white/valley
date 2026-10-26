import { expect, it } from 'vitest';
import { dialogueChoices, dialogueWords } from '../src/sim/dialogue.ts';
import { DIALOGUE_EDITION } from '../src/sim/edition.ts';
import { act, compactRun, load, newGame, save, step } from '../src/sim/game.ts';
import { required } from './required.ts';

function scene() {
  const g = newGame(7, undefined, false, true, DIALOGUE_EDITION);
  expect(act(g, { verb: 'call', job: 'reap-agha', houses: ['coban'] })).toBe(true);
  step(g, 1080);
  expect(act(g, { verb: 'visit', house: 'coban' })).toBe(true);
  step(g, 1110);
  return g;
}
function native(g: ReturnType<typeof newGame>) {
  const { savedAt: _at, ...rest } = save(g);
  return rest;
}
function roundTrip(g: ReturnType<typeof newGame>) {
  const full = load(save(g)),
    compact = load(compactRun(g));
  expect(native(full)).toEqual(native(g));
  expect(native(compact)).toEqual(native(g));
  return [full, compact];
}
it('binds two authored lines to actual Zehra and retains an ordinary withheld answer without rerolling', () => {
  const g = scene();
  const choices = dialogueChoices(g.valley);
  expect(choices.map((c) => c.line)).toEqual(['follow-up', 'work-need']);
  const follow = required(choices[0]);
  expect(g.valley.households.find((h) => h.id === follow.house)?.members).toContain('zehra');
  expect(follow.person).toBe('zehra');
  const prior = required(g.valley.notes.find((n) => n.id === follow.prior));
  expect(prior.who).toBe('zehra');
  expect(prior.at).toBeLessThanOrEqual(g.valley.minute);
  expect(dialogueWords(g.valley, follow)).toContain(prior.words);
  expect(dialogueWords(g.valley, required(choices[1]))).toContain('20 July');
  const workFork = load(save(g));
  const workChoice = required(dialogueChoices(workFork.valley)[1]);
  const people = structuredClone(g.valley.people);
  expect(act(g, follow)).toBe(true);
  expect(g.valley.people).toEqual(people); // speech is not perception, a forced decision or work
  expect(act(g, follow)).toBe(false);
  expect(g.valley.dialogue?.exchanges[0]?.status).toBe('pending');
  const forks = roundTrip(g);
  step(g, 1140);
  for (const fork of forks) {
    step(fork, 1140);
    expect(native(fork)).toEqual(native(g));
  }
  const e = required(required(g.valley.dialogue).exchanges[0]);
  expect(e.hearing?.deliveredAt).toBe(1110);
  expect(e.hearing?.percept.at).toBe(e.hearing?.deliveredAt);
  expect(e.hearing?.attended).toHaveLength(1);
  expect(e.hearing?.memoryTimes).toEqual([1110]);
  expect(e.status).toBe('withheld');
  expect(e.decisions[0]?.at).toBe(1114);
  expect(e.decisions[0]?.offer.action).not.toBe('valley-hearth-talk');
  expect(e.answerNote).toBeUndefined();
  expect(e.activity).toBeUndefined();
  roundTrip(g);
  expect(dialogueChoices(g.valley)).toEqual([]); // her actual next activity is sleep
  expect(act(g, follow)).toBe(false);
  expect(act(workFork, workChoice)).toBe(true);
  const pending = roundTrip(workFork);
  const cancelled = load(save(workFork));
  expect(act(cancelled, { verb: 'dialogue-cancel', turn: 0 })).toBe(true);
  expect(act(cancelled, { verb: 'dialogue-cancel', turn: 0 })).toBe(false);
  step(cancelled, 1230);
  expect(cancelled.valley.minute).toBe(1230);
  expect(required(cancelled.valley.dialogue).exchanges[0]?.status).toBe('cancelled');
  expect(required(cancelled.valley.dialogue).exchanges[0]?.answerNote).toBeUndefined();
  expect(cancelled.inputs.filter((i) => i.verb === 'dialogue')).toHaveLength(1);
  roundTrip(cancelled);
  step(workFork, 1230);
  for (const fork of pending) {
    step(fork, 1230);
    expect(native(fork)).toEqual(native(workFork));
  }
  expect(required(workFork.valley.dialogue).exchanges[0]?.answerNote).toBeUndefined();
  expect(required(workFork.valley.dialogue).exchanges[0]?.existingWork?.says).toBeDefined();
  roundTrip(workFork);
});

it('rejects stale, extra, unknown and absent-scene commands without side effects', () => {
  const g = scene();
  const choice = required(dialogueChoices(g.valley)[0]);
  const before = native(g);
  for (const invalid of [
    { ...choice, turn: -1 },
    { ...choice, prior: choice.prior + 100 },
    { ...choice, person: 'yusuf' },
    { ...choice, house: 'ak' },
    { ...choice, visit: choice.visit - 1 },
    { ...choice, line: 'secret' },
    { ...choice, ask: 'missing' },
    { ...choice, extra: true },
  ])
    expect(act(g, invalid as typeof choice)).toBe(false);
  expect(native(g)).toEqual(before);
  step(g, 1200);
  expect(act(g, choice)).toBe(false);
  expect(dialogueChoices(g.valley)).toEqual([]);
});
