import { describe, expect, it } from 'vitest';
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

describe('notebook run exports', () => {
  it('keeps the current cast day-12 schedule below 5 KB and replays to its recorded fingerprint', () => {
    const g = replay(406153184, ownerInputs, 17550);
    expect(fingerprint(g.valley)).toBe('9a783bd5');
    const run = compactRun(save(g));
    expect(run).toEqual(compactRun(g));
    expect(Buffer.byteLength(JSON.stringify(run))).toBeLessThan(5_000);
    expect(run).not.toHaveProperty('state');
    expect(run).not.toHaveProperty('savedAt');
    expect(run).toMatchObject({
      game: 'valley',
      seed: 406153184,
      version: '0.3.0',
      framework: '2.21.0',
      minute: 17550,
      inputs: ownerInputs,
      fingerprint: '9a783bd5',
      label: 'Volume I, 30 July of year one',
    });
    expect(fingerprint(load(JSON.parse(JSON.stringify(run))).valley)).toBe('9a783bd5');
  });

  it('keeps full-state downloads compatible and detaches the notebook input log', () => {
    const g = replay(7, [], 0);
    const full = save(g, 2);
    const run = compactRun(g, 2);
    expect(full).toHaveProperty('state');
    expect(full).toHaveProperty('savedAt');
    expect(run.label).toBe(full.label);
    expect(fingerprint(load(JSON.parse(JSON.stringify(full))).valley)).toBe(full.fingerprint);
    g.inputs.push({ verb: 'visit', house: 'dere', at: 0 });
    expect(run.inputs).toEqual([]);
  });

  it('compacts the captured export without reading a later game or changing the download', () => {
    const g = replay(7, [], 0);
    const full = save(g, 2);
    const json = JSON.stringify(full);
    g.inputs.push({ verb: 'visit', house: 'dere', at: 0 });
    const compact = compactRun(full);
    expect(compact).not.toHaveProperty('state');
    expect(compact).not.toHaveProperty('savedAt');
    expect(compact.inputs).toEqual([]);
    expect(compact.label).toBe(full.label);
    expect(fingerprint(load(compact).valley)).toBe(full.fingerprint);
    expect(JSON.stringify(full)).toBe(json);
    full.inputs.push({ verb: 'visit', house: 'dere', at: 0 });
    expect(compact.inputs).toEqual([]);
  });

  it('rejects a compact run whose replay does not match its fingerprint', () => {
    const run = compactRun(replay(7, [], 0));
    expect(() => load({ ...run, fingerprint: '00000000' })).toThrow(/Start a new game instead/i);
  });

  it('refuses a pre-rewrite compact export with a plain start-fresh message', () => {
    // Baseline 80a75d9: seed 7 at minute 0, no inputs. Only its prose fingerprint differs.
    const legacy = { ...compactRun(replay(7, [], 0)), fingerprint: '065eac42' };
    expect(() => load(legacy)).toThrow(
      'This file does not replay the same way in this version of The Valley. It may come from an older version. Start a new game instead.',
    );
  });

  it('detaches loaded inputs from compact and full exports', () => {
    const g = replay(406153184, ownerInputs.slice(0, 1), 2580);
    for (const run of [compactRun(g), save(g)]) {
      const loaded = load(run);
      const input = run.inputs[0];
      expect(input).toBeDefined();
      if (input) input.at = 30;
      expect(loaded.inputs[0]?.at).toBe(2580);
    }
  });
});
