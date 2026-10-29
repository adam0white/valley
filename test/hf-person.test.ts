import { describe, expect, it } from 'vitest';
import { createCommunity, tick } from '../src/sim/hf.ts';
import {
  ageYears,
  authoringOf,
  createPerson,
  frozenArchiveOf,
  frozenPerson,
  personRun,
  readBody,
} from '../src/sim/hf-person.ts';

const draft = () =>
  createPerson({
    id: 'person-test',
    name: 'Test person',
    seed: 7,
    now: 0,
    bornAt: -525600 * 30,
    sex: 'female',
  });
describe('HF4 Person boundary', () => {
  it('translates authored minutes once and retains draft habits before admission', () => {
    const p = draft();
    p.habits.push({ cue: { placeId: 'home' }, action: 'sleep', strength: 0.4, repetitions: 3, lastAt: -60 });
    const a = authoringOf(p);
    expect(a.identity.birthAt).toBe(-525600 * 30 * 60000);
    expect(a.state.habits[0]?.lastAt).toBe(-3600000);
    expect(personRun(p)).toBeUndefined();
  });
  it('reads admitted body and lifecycle only through the public Run', () => {
    const p = draft();
    createCommunity([p]);
    expect(p.life.sex).toBe('female');
    expect(p.body.health).toBe(1);
    expect(ageYears(p)).toBeGreaterThan(29.9);
    expect(ageYears(p)).toBeLessThan(30.1);
    expect(readBody(p).capacity).toBeGreaterThan(0);
    expect(personRun(p)).toBeDefined();
  });
  it('freezes a departure Run independently of continued live time', () => {
    const p = draft();
    createCommunity([p]);
    const source = frozenPerson(p);
    const archive = frozenArchiveOf(source);
    tick(p, 60);
    expect(p.now).toBe(60);
    expect(source.now).toBe(0);
    expect(frozenArchiveOf(source)).toBe(archive);
    expect(personRun(source)).not.toBe(personRun(p));
  });
  it('closes authoring and rejects mutation of admitted views', () => {
    const p = draft();
    createCommunity([p]);
    expect(() => authoringOf(p)).toThrow('closed');
    expect(() => {
      p.body.health = 0;
    }).toThrow();
    expect(() => {
      p.traits.honesty = 0;
    }).toThrow();
    expect(() => {
      p.now = 5;
    }).toThrow('read-only');
  });
});
