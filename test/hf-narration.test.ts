import { ENGINE_VERSION, FRAMEWORK_VERSION, linesFor } from '@adam0white/human-framework';
import { expect, it } from 'vitest';
import { compactRun, fingerprint, load, newGame, save, step } from '../src/sim/game.ts';

it('pins published HF and enables persisted plain narration for every fresh actor and newborn', () => {
  expect(FRAMEWORK_VERSION).toBe('3.0.0');
  expect(ENGINE_VERSION).toBe('2.23.0');
  const g = newGame(7);
  for (const p of [...g.valley.people, g.valley.kahya]) expect(p.lexicon?.plainEnglish).toBe(true);
  const initial = new Set(g.valley.people.map((p) => p.id));
  step(g, 20 * 1440);
  const children = g.valley.people.filter((p) => !initial.has(p.id));
  expect(children.length).toBeGreaterThan(0);
  for (const p of children) expect(p.lexicon?.plainEnglish).toBe(true);
  const fp = fingerprint(g.valley);
  expect(fingerprint(load(save(g)).valley)).toBe(fp);
  expect(fingerprint(load(compactRun(g)).valley)).toBe(fp);
  expect(linesFor('voice.assented.trusted', g.valley.kahya.lexicon)).toEqual([
    'I trust you, so I will go.',
    'That is a good idea. I will do it.',
  ]);
  expect(linesFor('voice.complied', g.valley.kahya.lexicon)).toEqual([
    'I will do it since you insist.',
    'I will do it if you insist, but I would rather not.',
  ]);
  expect(linesFor('voice.commanded', g.valley.kahya.lexicon)).toEqual([
    'I will do it.',
    'I will do what you say.',
  ]);
});

it('restores a saved narration choice without silently opting in', () => {
  const g = newGame(7, undefined, false, false);
  const file = save(g);
  const loaded = load(file);
  for (const p of [...loaded.valley.people, loaded.valley.kahya]) expect(p.lexicon?.plainEnglish).toBe(false);
  expect(fingerprint(loaded.valley)).toBe(file.fingerprint);
  expect(fingerprint(load(compactRun(loaded)).valley)).toBe(file.fingerprint);
  expect(fingerprint(load(compactRun(file)).valley)).toBe(file.fingerprint);
  for (const p of loaded.valley.people)
    if (p.family?.pregnancy) p.lexicon = { ...p.lexicon, names: { unrelated: 'Custom name' } };
  const initial = new Set(loaded.valley.people.map((p) => p.id));
  step(loaded, 20 * 1440);
  const children = loaded.valley.people.filter((p) => !initial.has(p.id));
  expect(children.length).toBeGreaterThan(0);
  for (const p of children) expect(p.lexicon).toEqual({ plainEnglish: false });
});
