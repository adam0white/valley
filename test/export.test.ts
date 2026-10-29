import { describe, expect, it } from 'vitest';
import { act, compactRun, fingerprint, load, newGame, replay, save, step } from '../src/sim/game.ts';

describe('notebook run exports', () => {
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

  it('refuses an HF3 compact export with a keep-file and start-fresh message', () => {
    const legacy = {
      ...compactRun(replay(7, [], 0)),
      version: '0.3.1',
      framework: '3.0.0',
      fingerprint: '065eac42',
    };
    expect(() => load(legacy)).toThrow(/export it for safekeeping and start fresh/i);
  });

  it('detaches loaded inputs from compact and full exports', () => {
    const g = newGame(7, undefined, false, true, 'valley-public-2026-10');
    expect(act(g, { verb: 'call', job: 'reap-agha', houses: ['coban'] })).toBe(true);
    const originalAt = g.inputs[0]?.at;
    expect(originalAt).toBeDefined();
    for (const run of [compactRun(g), save(g)]) {
      const loaded = load(run);
      const input = run.inputs[0];
      expect(input).toBeDefined();
      if (input) input.at = 30;
      expect(loaded.inputs[0]?.at).toBe(originalAt);
    }
  });
});

it('replays an introductory visit followed by a household call with the usual travel cost', () => {
  const g = newGame(7);
  const start = g.valley.minute;
  expect(act(g, { verb: 'visit', house: 'coban' })).toBe(true);
  expect(g.valley.kahyaState.visit).toMatchObject({
    arrive: start + 20,
    leave: start + 110,
    back: start + 130,
  });
  expect(act(g, { verb: 'visit', house: 'ak' })).toBe(false);
  step(g, start + 150);
  expect(act(g, { verb: 'call', job: 'reap-agha', houses: ['coban'] })).toBe(true);
  step(g, start + 360);
  const exported = compactRun(g);
  expect(fingerprint(load(JSON.parse(JSON.stringify(exported))).valley)).toBe(fingerprint(g.valley));
});

it('preserves the complete public-edition state across native and compact exports and rejects native archive corruption', () => {
  const g = newGame(7, undefined, false, true, 'valley-public-2026-10');
  expect(act(g, { verb: 'call', job: 'reap-agha', houses: ['coban'] })).toBe(true);
  const full = JSON.parse(JSON.stringify(save(g))) as ReturnType<typeof save>;
  const compact = JSON.parse(JSON.stringify(compactRun(g))) as ReturnType<typeof compactRun>;
  expect(compact.inputs).toEqual(g.inputs);
  const fullReload = load(full);
  const compactReload = load(compact);
  expect(save(fullReload).state).toEqual(full.state);
  expect(save(compactReload).state).toEqual(full.state);
  const altered = structuredClone(full);
  const archive = altered.state.community.archive;
  if (!archive) throw new Error('Missing native Run archive');
  Object.assign(archive.current, { at: archive.current.at + 1 });
  expect(() => load(altered)).toThrow();
}, 60_000);
