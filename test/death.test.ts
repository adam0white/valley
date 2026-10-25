import { createPerson, die, seedTie } from '@adam0white/human-framework';
import { expect, it } from 'vitest';
import { tellValleyDeath } from '../src/sim/death.ts';

it('tells a related resident already past a death without rewinding their clock', () => {
  const person = (id: string, now: number) =>
    createPerson({ id, name: id, seed: 1, now, bornAt: -10000000, sex: 'female' });
  const dead = person('dead', 60);
  const listener = person('listener', 120);
  die(dead);
  seedTie(listener, { otherId: dead.id, affection: 0.8, familiarity: 1, roles: ['friend'] });
  tellValleyDeath([dead, listener], dead, 60);
  expect(listener.now).toBe(120);
  expect(listener.social.relationships.find((r) => r.otherId === dead.id)?.deceasedAt).toBe(120);
  expect(listener.memory.episodes.some((e) => e.at === 120 && e.summary === 'dead died')).toBe(true);
});
