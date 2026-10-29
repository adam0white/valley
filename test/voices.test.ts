import { expect, it } from 'vitest';
import { createCommunity, createPerson } from '../src/sim/hf.ts';
import { visitWords } from '../src/sim/voices.ts';

it('uses current visit context without reading unavailable private memory or inventing an earlier visit history', () => {
  const p = createPerson({ id: 'voice-test', name: 'Visitor', seed: 7, sex: 'female', bornAt: -25 * 525600 });
  createCommunity([p]);
  const visible = new Proxy(p, {
    get(target, key, receiver) {
      if (key === 'memory') throw new Error('Private memory is unavailable');
      return Reflect.get(target, key, receiver);
    },
  });
  const said: Record<string, number> = {};
  const words = visitWords({ seed: 7, minute: 0, said, bread: 100, trust: 0.5 }, visible, true);
  expect(words).toContain('You have come to our door. What do you need?');
  expect(words).not.toMatch(/No steward|first of them|remember|forgotten|last steward took our ox/);
  expect(Object.keys(said).length).toBeGreaterThan(0);
});
