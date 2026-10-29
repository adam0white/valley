import { expect, it } from 'vitest';
import { compactRun, fingerprint, type Input, load, replay, save } from '../src/sim/game.ts';

// The owner's day-12 actions, without the private full-state replay file.
const ownerInputs: Input[] = [
  {
    verb: 'call',
    job: 'reap-agha',
    houses: ['kavak', 'ak', 'coban', 'dere', 'kara', 'demirci', 'kuyucu', 'tepe'],
    at: 2580,
  },
  { verb: 'visit', house: 'coban', why: 'birth', at: 3510 },
  { verb: 'give', house: 'coban', kile: 6, at: 3930 },
  { verb: 'give', house: 'tepe', kile: 6, at: 5130 },
  { verb: 'give', house: 'kuyucu', kile: 6, at: 5370 },
  { verb: 'give', house: 'demirci', kile: 6, at: 5520 },
  { verb: 'give', house: 'ak', kile: 6, at: 5670 },
  { verb: 'visit', house: 'dere', at: 7590 },
  { verb: 'visit', house: 'tepe', at: 7980 },
  { verb: 'visit', house: 'kara', at: 8280 },
  { verb: 'visit', house: 'coban', at: 8730 },
  { verb: 'visit', house: 'demirci', at: 9630 },
  { verb: 'visit', house: 'ak', at: 10080 },
  { verb: 'visit', house: 'kuyucu', at: 10530 },
  { verb: 'visit', house: 'kavak', at: 11190 },
];

it('keeps the current cast day-12 schedule below 5 KB and replays to its recorded fingerprint', () => {
  const g = replay(406153184, ownerInputs, 17550, undefined, true, 'valley-public-2026-10');
  expect(fingerprint(g.valley)).toBe('80bf0dc3');
  const run = compactRun(save(g));
  expect(run).toEqual(compactRun(g));
  expect(Buffer.byteLength(JSON.stringify(run))).toBeLessThan(5_000);
  expect(run).not.toHaveProperty('state');
  expect(run).not.toHaveProperty('savedAt');
  expect(run).toMatchObject({
    game: 'valley',
    seed: 406153184,
    version: '0.4.0',
    framework: '4.8.0',
    minute: 17550,
    inputs: ownerInputs,
    fingerprint: '80bf0dc3',
    label: 'Volume I, 30 July of year one',
  });
  expect(fingerprint(load(JSON.parse(JSON.stringify(run))).valley)).toBe('80bf0dc3');
});
