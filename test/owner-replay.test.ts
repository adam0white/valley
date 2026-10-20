import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { fingerprint, load, replay, type SavedGame } from '../src/sim/game.ts';
import { englishText, limitsWords, nextWords, nowWords } from '../src/ui/presentation.ts';

// The private export is never copied into the repo. Set this path to run the owner regression locally.
const path = process.env.VALLEY_OWNER_EXPORT;
it.skipIf(!path)(
  'keeps the owner export and its input replay at the recorded fingerprint after rendering copy',
  () => {
    if (!path) return;
    const saved = JSON.parse(readFileSync(path, 'utf8')) as SavedGame;
    const restored = load(saved);
    expect(fingerprint(restored.valley)).toBe(saved.fingerprint);
    for (const note of restored.valley.notes) {
      englishText(note.text);
      englishText(note.words ?? '');
    }
    nowWords(restored.valley);
    nextWords(restored.valley);
    for (const h of restored.valley.households) limitsWords(restored.valley, h);
    expect(fingerprint(restored.valley)).toBe(saved.fingerprint);
    // Fingerprint before switching instances: load() resets the simulation's module caches.
    const rebuilt = replay(saved.seed, saved.inputs, saved.minute);
    expect(fingerprint(rebuilt.valley)).toBe(saved.fingerprint);
    expect(rebuilt.inputs).toEqual(saved.inputs);
  },
);
