import { expect, it } from 'vitest';
import { automaticRate } from '../src/ui/pacing.ts';

const quiet = { night: false, travelling: false, reading: false, waiting: false, hurrying: false };
it('crosses quiet nights briskly but keeps a journey at the daytime pace', () => {
  expect(automaticRate({ ...quiet, night: true })).toBeGreaterThan(automaticRate(quiet));
  expect(automaticRate({ ...quiet, night: true, travelling: true })).toBe(automaticRate(quiet));
});
it('protects a reply and an unanswered door even when fast-forwarding', () => {
  expect(automaticRate({ ...quiet, hurrying: true, reading: true })).toBe(
    automaticRate({ ...quiet, reading: true }),
  );
  expect(automaticRate({ ...quiet, hurrying: true, waiting: true })).toBeLessThan(
    automaticRate({ ...quiet, reading: true }),
  );
});

it('uses seasonal automatic pacing while preserving reading and menu overrides', () => {
  expect(automaticRate({ ...quiet, working: true })).toBe(120);
  expect(automaticRate({ ...quiet, working: false })).toBe(240);
  expect(automaticRate({ ...quiet, working: true, pace: 'fast' })).toBe(480);
  expect(automaticRate({ ...quiet, pace: 'fast', reading: true })).toBe(2);
});
