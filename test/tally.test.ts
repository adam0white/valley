import { expect, it } from 'vitest';
import { fingerprint, newGame, save } from '../src/sim/game.ts';
import { closingGrain } from '../src/ui/tally.ts';

it('reckons grain only by choice at either clear ending without changing the run', () => {
  const g = newGame(7);
  expect(closingGrain(g.valley, true)).toBe('');
  for (const end of ['dismissed', 'term', 'empty'] as const) {
    g.valley.flags.ended = end;
    g.valley.agha.granary = 12.6;
    g.valley.stats.given = 7.2;
    const before = fingerprint(g.valley);
    const run = save(g);
    expect(closingGrain(g.valley, false)).toBe('');
    expect(closingGrain(g.valley, true)).toContain('20 kile total = 13 left in the granary + 7 given away');
    expect(closingGrain(g.valley, true)).toContain('rounded');
    expect(fingerprint(g.valley)).toBe(before);
    expect(save(g).state).toEqual(run.state);
  }
});

it('keeps older saves without gift counters readable', () => {
  const s = newGame(7).valley;
  s.flags.ended = 'dismissed';
  s.agha.granary = 4;
  expect(closingGrain(s, true)).toContain('4 kile total = 4 left in the granary + 0 given away');
});
