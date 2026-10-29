import { expect, it } from 'vitest';
import { dialogueChoices } from '../src/sim/dialogue.ts';
import { PUBLIC_EDITION } from '../src/sim/edition.ts';
import { act, compactRun, load, newGame, restoreState, save, step } from '../src/sim/game.ts';
import { required } from './required.ts';

it('keeps all five older configurations closed to dialogue commands', () => {
  for (const rules of [
    undefined,
    'valley-2026-10',
    'valley-pass-2026-10',
    'valley-replies-2026-10',
    'valley-alliance-2026-10',
  ] as const) {
    const g = newGame(7, undefined, false, true, rules);
    const state = structuredClone(save(g).state);
    const input = {
      verb: 'dialogue',
      turn: 0,
      person: 'zehra',
      house: 'coban',
      visit: 440,
      prior: 1,
      line: 'follow-up',
    } as const;
    expect(act(g, input)).toBe(false);
    expect(act(g, { verb: 'dialogue-cancel', turn: 0 })).toBe(false);
    expect(save(g).state).toEqual(state);
    const file = compactRun(g);
    file.inputs.push({ ...input, at: 420 });
    expect(() => load(file)).toThrow(/dialogue/i);
  }
});
it('validates a detached dialogue native file and bound recovery before installing it', () => {
  const g = newGame(7, undefined, false, true, PUBLIC_EDITION);
  act(g, { verb: 'call', job: 'reap-agha', houses: ['coban'] });
  // This public control uses a real delayed reply and attended visit.
  step(g, 480);
  expect(act(g, { verb: 'insist', ask: 'a1-420', pid: 'zehra' })).toBe(true);
  step(g, 750);
  expect(act(g, { verb: 'visit', house: 'coban' })).toBe(true);
  step(g, 810);
  expect(act(g, required(dialogueChoices(g.valley)[0]))).toBe(true);
  const full = save(g);
  expect(() => load(full)).not.toThrow();
  const invalid = structuredClone(full);
  required(required(invalid.state.dialogue).exchanges[0]).saidAt = 999999;
  expect(() => restoreState(invalid.state)).toThrow(/dialogue/i);
  expect(() => load(invalid)).toThrow(/dialogue/i);
  const forged = structuredClone(full);
  required(required(forged.state.dialogue).exchanges[0]).words = 'invented';
  expect(() => load(forged)).toThrow(/complete replay state/i);
  const extra = structuredClone(full);
  extra.inputs.push({ ...required(extra.inputs.at(-1)), at: 810 });
  expect(() => load(extra)).toThrow(/complete replay state/i);
  const missing = structuredClone(full);
  delete missing.state.dialogue;
  expect(() => load(missing)).toThrow(/dialogue/i);
  const mixed = structuredClone(full);
  mixed.state.edition = { id: 'valley-2026-10' };
  expect(() => restoreState(mixed.state)).toThrow(/reply edition state/i);
});
