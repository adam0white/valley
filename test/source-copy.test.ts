import { expect, it } from 'vitest';
import { newGame } from '../src/sim/game.ts';
import { householdLabel, personLabel } from '../src/sim/people.ts';
import { note, peopleList } from '../src/sim/valley.ts';
import { rememberedLine, visitWords } from '../src/sim/voices.ts';

it('groups unnamed people without losing their count or changing saved names', () => {
  const names = ['a household member', 'a household member', 'Dürdane', 'Ramazan', 'a child'];
  expect(peopleList(names)).toBe('Dürdane, Ramazan and 3 other people');
  expect(peopleList(['a household member', 'a child'])).toBe('2 people');
  expect(peopleList(['a household member'])).toBe('someone');
  expect(peopleList(['Dürdane', 'a household member'])).toBe('Dürdane and 1 other person');
  expect(names).toEqual(['a household member', 'a household member', 'Dürdane', 'Ramazan', 'a child']);
});

it('starts new and revised role sentences with a capital letter', () => {
  const s = newGame(7).valley;
  const name = personLabel({ name: 'a household member' }, { name: 'the Kavak house' });
  note(s, { at: 0, kind: 'story', weight: 1, text: `${name} refused at first, then came.` });
  expect(s.notes.at(-1)?.text).toBe('Someone from the Kavak house refused at first, then came.');
});

it('keeps birth greetings compatible with either baby and preserves repetition keys', () => {
  const p = newGame(7).valley.people[0];
  if (!p) throw new Error('Missing person');
  for (const born of ['Bilal (boy)', 'Leyla (girl)']) {
    for (let seed = 0; seed < 50; seed++) {
      const text = visitWords({ seed, minute: 0, said: {}, bread: 100, trust: 0.5, born }, p, true, 'birth');
      expect(text).not.toContain('She’s only just asleep');
      expect(text).not.toContain('doesn’t sleep. Nobody');
    }
  }
  expect(rememberedLine('{child} hardly ever sleeps, so none of us get much sleep.')).toBe(
    '{child} doesn’t sleep. Nobody in this house sleeps.',
  );
  expect(rememberedLine('Come in quietly. We are trying to let the baby sleep.')).toBe(
    'Come in, quietly. She’s only just asleep.',
  );
});

it('shows guest lodging names without changing saved household names', () => {
  const h = { id: 'water-guest', name: 'the Water guest house' };
  expect(householdLabel(h)).toBe('Danyal’s lodging');
  expect(h.name).toBe('the Water guest house');
  expect(householdLabel({ id: 'guests', name: 'the Survey guest house' })).toBe(
    'the survey visitors’ lodging',
  );
});

it('keeps the wood-saving notice identity when naming the household explicitly', () => {
  expect(
    rememberedLine(
      'There was no smoke from the {fam} chimney this morning. {who} says the household is saving wood.',
    ),
  ).toBe('There was no smoke from the {fam} chimney this morning. {who} says they are saving wood.');
});
