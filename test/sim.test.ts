import { describe, expect, it } from 'vitest';
import { DAY } from '../src/sim/calendar.ts';
import { act, fingerprint, gathering, load, newGame, replay, save, step } from '../src/sim/game.ts';
import { underSeal } from '../src/sim/valley.ts';

const houses = (g: ReturnType<typeof newGame>) =>
  g.valley.households.filter((h) => underSeal(g.valley, h)).map((h) => h.id);

function play(days: number) {
  const g = newGame(7);
  step(g, 8 * 60);
  act(g, { verb: 'call', job: 'reap-agha', houses: houses(g), wage: false });
  step(g, 1 * DAY + 9 * 60);
  act(g, { verb: 'visit', house: 'dere' });
  step(g, 3 * DAY + 7 * 60);
  const a = g.valley.asks[0];
  const off = a && Object.entries(a.replies).find(([, r]) => r.verdict === 'deferred');
  if (a && off) act(g, { verb: 'insist', ask: a.id, pid: off[0] });
  step(g, days * DAY);
  return g;
}

describe('the valley', () => {
  it('replays an input log to the same fingerprint', () => {
    const g = play(8);
    const fp = fingerprint(g.valley);
    const r = replay(7, g.inputs, g.valley.minute);
    expect(fingerprint(r.valley)).toBe(fp);
  });

  it('a saved volume restores and carries on identically', () => {
    const g = play(6);
    const sv = save(g);
    const a = load(JSON.parse(JSON.stringify(sv)));
    expect(fingerprint(a.valley)).toBe(sv.fingerprint);
    step(g, 8 * DAY);
    step(a, 8 * DAY);
    expect(fingerprint(a.valley)).toBe(fingerprint(g.valley));
  });

  it('answers to the harvest call are not all a plain yes, and not mostly no', () => {
    const g = play(10);
    const v = g.valley.stats.harvestVerdicts;
    const total = Object.values(v).reduce((x, y) => x + y, 0);
    expect(total).toBeGreaterThan(10);
    const notYes = (total - (v.assented ?? 0)) / total;
    // Target 25 to 40% (docs/design.md); this bound is loose on purpose until polish round 1 tunes it.
    expect(notYes).toBeGreaterThan(0.2);
    expect(notYes).toBeLessThan(0.65);
  });

  it('every elder at the gathering says something in their own voice', () => {
    const g = play(4);
    g.valley.flags.ended = 'term';
    const { elders, letter } = gathering(g);
    expect(letter.length).toBeGreaterThan(10);
    expect(elders.length).toBeGreaterThan(5);
    for (const e of elders) {
      expect(e.words.length).toBeGreaterThan(10);
      expect(e.words).not.toMatch(/you’s|the kahya/);
    }
  });
});
