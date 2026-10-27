import { expect, it } from 'vitest';
import { dialogueChoices } from '../src/sim/dialogue.ts';
import { act, compactRun, load, newGame, save, step } from '../src/sim/game.ts';
import { zehraScene } from '../src/ui/scene-context.ts';
import { required } from './required.ts';

it('reads the actual Zehra visit and later cut field without changing state or promising an answer', () => {
  const g = newGame(7, undefined, false, true, 'valley-public-2026-10');
  const s = g.valley;
  expect(
    act(g, {
      verb: 'call',
      job: 'reap-agha',
      houses: s.households.filter((h) => h.hamlet === 'lower').map((h) => h.id),
    }),
  ).toBe(true);
  step(g, 1080);
  expect(act(g, { verb: 'visit', house: 'coban' })).toBe(true);
  expect(zehraScene(s, 'coban')?.reason).toContain('still walking');
  step(g, 1110);
  const before = structuredClone(s);
  const scene = required(zehraScene(s, 'coban'));
  expect(scene.source?.who).toBe('zehra');
  expect(scene.source?.at).toBeLessThanOrEqual(s.minute);
  expect(scene.reason).toContain('She may choose not to answer');
  expect(s).toEqual(before);
  const question = required(dialogueChoices(s)[0]);
  expect(act(g, question)).toBe(true);
  expect(zehraScene(s, 'coban')?.reason).toContain('no completed answer');
  const cancelled = load(save(g));
  expect(act(cancelled, { verb: 'dialogue-cancel', turn: 0 })).toBe(true);
  step(g, 1140);
  expect(s.dialogue?.exchanges[0]?.status).toBe('withheld');
  expect(zehraScene(s, 'coban')?.reason).toContain('asleep');
  step(cancelled, 1140);
  expect(cancelled.valley.dialogue?.exchanges[0]?.status).toBe('cancelled');
  expect(cancelled.valley.dialogue?.exchanges[0]?.answerNote).toBeUndefined();
  // Continue this one public causal schedule until the actual field is cut. No world edits or seed search.
  while (s.agha.standing > 5 && s.minute < 10 * 1440) step(g, s.minute + 30);
  expect(s.agha.standing).toBeLessThanOrEqual(5);
  expect(act(g, { verb: 'visit', house: 'coban' })).toBe(true);
  step(g, s.minute + 30);
  const afterCut = required(zehraScene(s, 'coban'));
  expect(afterCut.source?.who).toBe('zehra');
  expect(afterCut.source?.at).toBeLessThanOrEqual(s.minute);
  expect(afterCut.reason).not.toContain('must answer');
  const saved = save(g);
  const compact = compactRun(g);
  const target = s.minute + 1440;
  for (const run of [saved, compact]) {
    const restored = load(run);
    const { savedAt: _a, ...expected } = saved;
    const { savedAt: _b, ...actual } = save(restored);
    expect(actual).toEqual(expected);
    step(restored, target);
    step(g, target);
    const { savedAt: _c, ...continued } = save(g);
    const { savedAt: _d, ...replayed } = save(restored);
    expect(replayed).toEqual(continued);
  }
});
