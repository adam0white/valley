import { describe, expect, it } from 'vitest';
import { DAY, START_DOY, YEAR_DAYS } from '../src/sim/calendar.ts';
import { fingerprint, newGame } from '../src/sim/game.ts';
import { call, shareOwed } from '../src/sim/valley.ts';
import {
  dateEnglish,
  englishText,
  limitsWords,
  nextWords,
  nowWords,
  PURPOSE,
} from '../src/ui/presentation.ts';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Required test fixture is missing');
  return value;
}

const atDoy = (doy: number) => {
  const s = newGame(7).valley;
  s.minute = ((doy - START_DOY + YEAR_DAYS) % YEAR_DAYS) * DAY;
  return s;
};

describe('owner-facing presentation', () => {
  it('translates calendar and essential terms while keeping names and greetings', () => {
    expect(englishText('Osman: “Selam, kahya. 5 Ağustos; agha’s konak; 6 kile.”')).toBe(
      'Osman: “Selam, steward. 5 August; landowner’s residence; 6 grain measures.”',
    );
    expect(englishText('Kahya, aghast at the kilen.')).toBe('Steward, aghast at the kilen.');
    expect(dateEnglish(0)).toBe('18 July');
    expect(dateEnglish(18)).toBe('5 August');
    expect(dateEnglish(167)).toBe('1 January');
    expect(PURPOSE).toMatch(/due/);
    expect(PURPOSE).toMatch(/fed/);
    expect(PURPOSE).toMatch(/trust/);
    expect(PURPOSE).toMatch(/elders/);
  });

  it('explains the seasonal calendar without moving time', () => {
    const cases = [
      [198, /5 August.*9 August/],
      [216, /9 August/],
      [220, /rider/],
      [270, /sowing/],
      [290, /winter/i],
      [340, /mill/],
      [90, /summer/i],
      [160, /upper hamlet/],
    ] as const;
    for (const [doy, expected] of cases) {
      const s = atDoy(doy);
      const before = fingerprint(s);
      expect(nextWords(s)).toMatch(expected);
      expect(nowWords(s)).not.toBe('');
      expect(limitsWords(s)).not.toBe('');
      for (const h of s.households) limitsWords(s, h);
      expect(fingerprint(s)).toBe(before);
    }
  });

  it('explains the owner’s cut-field wait and empty granary without inventing an action allowance', () => {
    const s = atDoy(210);
    s.agha.standing = 0;
    s.agha.reaped = 176;
    s.agha.granary = 0;
    s.flags.verbs.push('visit');
    expect(nowWords(s)).toMatch(/barley is cut/);
    expect(nextWords(s)).toMatch(/5 August/);
    expect(limitsWords(s)).toMatch(/gifts open again when threshing/);
    expect(limitsWords(s)).toMatch(/go again when you return/);
  });

  it('keeps later harvest guidance consistent with shares already revealed', () => {
    const s = atDoy(198);
    s.flags.verbs.push('take');
    expect(nextWords(s)).toMatch(/during threshing/);
    expect(nextWords(s)).not.toMatch(/9 August/);
    s.minute = 18 * DAY;
    s.agha.standing = 0;
    expect(nowWords(s)).toMatch(/unpaid households/);
  });

  it('gives one current directive and ignores future and expired knocks', () => {
    const s = atDoy(198);
    const knock = {
      id: 'test',
      personId: 'test',
      house: 'dere',
      what: 'grain' as const,
      words: '',
      at: s.minute,
      until: s.minute + DAY,
    };
    s.knocks.push(knock);
    expect(nowWords(s)).toMatch(/door/);
    knock.at = s.minute + DAY;
    expect(nowWords(s)).toMatch(/barley/);
    knock.at = s.minute - DAY;
    knock.until = s.minute;
    expect(nowWords(s)).toMatch(/barley/);
    s.kahyaState.visit = {
      house: 'dere',
      arrive: s.minute + 20,
      leave: s.minute + 110,
      back: s.minute + 130,
    };
    expect(nowWords(s)).toMatch(/return/);
    s.flags.ended = 'term';
    expect(nowWords(s)).toMatch(/elders/);
  });

  it('explains an open call and its actual expiry without suggesting another call', () => {
    const s = atDoy(198);
    const h = required(s.households.find((h) => h.hamlet === 'lower' && h.members.length));
    const ask = required(call(s, 'reap-agha', [h.id]));
    const before = fingerprint(s);
    expect(nowWords(s)).toMatch(/replies/);
    expect(limitsWords(s, h)).toContain(dateEnglish(Math.floor(ask.until / DAY)));
    expect(limitsWords(s, h)).toMatch(/expires/);
    expect(fingerprint(s)).toBe(before);
    ask.closed = true;
    expect(limitsWords(s, h)).not.toMatch(/expires/);
  });

  it('uses travel, crop renewal, and loan renewal rather than invented fatigue or daily allowances', () => {
    const s = atDoy(220);
    const h = required(s.households.find((h) => h.hamlet === 'lower' && h.members.length));
    h.eased = true;
    h.paid = shareOwed(h);
    s.agha.granary = 0;
    s.kahyaState.visit = { house: h.id, arrive: s.minute, leave: s.minute + 90, back: s.minute + 110 };
    s.agha.loan = { kile: 80, owe: 100, asked: s.minute, arrives: s.minute + 12 * DAY };
    const text = limitsWords(s, h);
    expect(text).toMatch(/return/);
    expect(text).toMatch(/25 June/);
    expect(text).toMatch(/loan.*again/);
    expect(text).toMatch(/granary.*empty/);
    expect(text).not.toMatch(/fatigue|daily allowance|action points/);
    const upper = required(s.households.find((h) => h.hamlet === 'upper'));
    expect(limitsWords(s, upper)).toMatch(/seal/);
    upper.members = [];
    expect(limitsWords(s, upper)).toMatch(/empty/);
  });
});
