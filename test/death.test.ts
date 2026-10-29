import { expect, it } from 'vitest';
import { tellValleyDeath } from '../src/sim/death.ts';
import { bridgeAt, bridgeInput, createCommunity, createPerson, seedTie, serve, tick } from '../src/sim/hf.ts';

it('delivers earlier death news at the current shared Run clock without rewinding', () => {
  const person = (id: string) =>
    createPerson({ id, name: id, seed: 1, now: 0, bornAt: -10000000, sex: 'female' });
  const dead = person('dead'),
    listener = person('listener');
  seedTie(listener, { otherId: dead.id, affection: 0.8, familiarity: 1, roles: ['friend'] });
  const c = createCommunity([dead, listener]);
  const stamp = bridgeAt(c, 60);
  serve(c, stamp, [
    bridgeInput(
      c,
      'lifecycle.received',
      {
        type: 'death',
        person: { kind: 'actor', id: dead.id },
        basis: { evidence: { kind: 'evidence', id: 'death-at-60' }, worldRevision: c.revision ?? 0 },
      },
      stamp,
    ),
  ]);
  tick(listener, 120);
  const before = listener.now;
  tellValleyDeath([dead, listener], dead, 60);
  expect(listener.now).toBeGreaterThanOrEqual(before);
  expect(listener.now - before).toBeLessThan(1 / 6000);
  expect(listener.social.relationships.find((r) => r.otherId === dead.id)?.deceasedAt).toBe(listener.now);
  expect(dead.body.alive).toBe(false);
});
