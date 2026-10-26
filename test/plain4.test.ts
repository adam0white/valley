import { expect, it } from 'vitest';
import { DISCLOSURES } from '../src/sim/cast.ts';
import { compactRun, fingerprint, load, newGame, save } from '../src/sim/game.ts';
import { visitWords } from '../src/sim/voices.ts';
import { englishText, limitsWords, noteWords, paidShareWords } from '../src/ui/presentation.ts';
import { required } from './required.ts';

it('projects all five copy routes while preserving raw source and export state', () => {
  const g = newGame(7);
  const s = g.valley;
  const before = JSON.stringify(s);
  const h = required(s.households.find((h) => h.id === 'water-guest'));
  expect(paidShareWords(s, h)).toBe('Danyal’s share is paid.');
  h.eased = true;
  expect(limitsWords(s, h)).toContain('Danyal’s share has already been reduced.');
  const paid = h.paid;
  h.paid = 999;
  expect(limitsWords(s, h).match(/Shares and reductions renew/g)).toHaveLength(1);
  h.eased = false;
  expect(limitsWords(s, h).match(/Shares and reductions renew/g)).toHaveLength(1);
  h.paid = paid;
  expect(englishText(required(s.households.find((h) => h.id === 'guests')).looks)).not.toMatch(
    /home records|promised paid|different families/,
  );
  expect(englishText(h.looks)).not.toMatch(/home records|journey home/);
  expect(
    englishText(
      'Danyal agrees to leave after the current work. He must still meet any duties and follow any health limits. The visit has not ended yet.',
    ),
  ).toBe('Danyal will leave when the current work ends.');
  expect(englishText('Someone from the Kara house had a boy.')).toBe('A woman of the Kara house had a boy.');
  expect(englishText('Someone from the Tepe house married someone from the Dere house.')).toBe(
    'A woman of the Tepe house married a man of the Dere house.',
  );
  expect(englishText('Someone from the Kara house married Yusuf of the Çoban house.')).toBe(
    'A woman of the Kara house married Yusuf of the Çoban house.',
  );
  expect(englishText('Samira of the survey visitors’ lodging married someone from the Tepe house.')).toBe(
    'Samira of the survey visitors’ lodging married a man of the Tepe house.',
  );
  expect(englishText('Yusuf married Zehra.')).toBe('Yusuf married Zehra.');
  expect(englishText(required(DISCLOSURES.yusuf))).toContain('a small piece of wood.');
  expect(englishText(required(DISCLOSURES.yusuf))).toContain('His debt remains');
  const p = required(s.people.find((p) => p.id === 'yusuf'));
  for (let seed = 0; seed < 40; seed++) {
    const words = visitWords({ seed, minute: 1000, said: {}, bread: seed * 3, trust: seed / 40 }, p, true);
    const n = { kind: 'voice', text: 'Yusuf speaks by the fire:', words };
    const shown = required(noteWords(n));
    expect(words.startsWith(shown)).toBe(true);
    expect(shown.match(/steward/gi)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(noteWords({ ...n, text: 'Yusuf replies:' })).toBe(words);
    expect(n.words).toBe(words);
  }
  expect(JSON.stringify(s)).toBe(before);
  expect(fingerprint(load(save(g)).valley)).toBe(fingerprint(s));
  expect(fingerprint(load(compactRun(g)).valley)).toBe(fingerprint(s));
});
