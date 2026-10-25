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

  it('put-offs of one ask on one day share one line, and nobody is on two lines that day', () => {
    const g = play(3);
    const seen = new Map<string, string>();
    for (const n of g.valley.notes.filter((n) => n.kind === 'reply' && n.ask)) {
      if (n.group?.startsWith('off-')) {
        expect(seen.has(n.group)).toBe(false);
        seen.set(n.group, n.text);
        expect(n.ids?.length).toBe(n.names?.length);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
    const offIds = g.valley.notes.flatMap((n) =>
      n.group?.startsWith('off-') ? (n.ids ?? []).map((id) => `${n.group}|${id}`) : [],
    );
    expect(new Set(offIds).size).toBe(offIds.length);
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

describe('what a house says', () => {
  it('answers a visit in a named person’s words, and the next house says something else', () => {
    const g = newGame(7);
    step(g, 8 * 60);
    act(g, { verb: 'visit', house: 'dere' });
    step(g, 1 * DAY);
    act(g, { verb: 'visit', house: 'kara' });
    step(g, 2 * DAY);
    const voices = g.valley.notes.filter((n) => n.kind === 'voice');
    expect(voices.length).toBe(2);
    expect(voices[0]?.text).toMatch(/of the Dere house speaks by the fire:/);
    expect(voices[0]?.words).toBeTruthy();
    expect(voices[0]?.words).not.toBe(voices[1]?.words);
  });

  it('remembers who was seized from at the end of the term', () => {
    const g = newGame(7);
    step(g, 8 * 60);
    act(g, { verb: 'seize', house: 'dere' });
    step(g, 60);
    expect(g.valley.stats.hard ?? []).toContain('dere');
  });
});
