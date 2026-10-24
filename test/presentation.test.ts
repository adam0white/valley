import { describe, expect, it } from 'vitest';
import { DAY, monthEnglish, START_DOY, YEAR_DAYS } from '../src/sim/calendar.ts';
import { compactRun, fingerprint, newGame, save, volumeLabel } from '../src/sim/game.ts';
import { call, shareOwed } from '../src/sim/valley.ts';
import {
  callUnavailable,
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
  it('keeps English month boundaries across game years without changing state', () => {
    const months = [
      ['January', 31],
      ['February', 28],
      ['March', 31],
      ['April', 30],
      ['May', 31],
      ['June', 30],
      ['July', 31],
      ['August', 31],
      ['September', 30],
      ['October', 31],
      ['November', 30],
      ['December', 31],
    ] as const;
    const g = newGame(7);
    let doy = 0;
    for (const [name, length] of months) {
      for (const year of [1, 2, 3]) {
        for (const date of [1, length]) {
          const day = year * YEAR_DAYS + doy + date - 1 - START_DOY;
          g.valley.minute = day * DAY;
          const before = fingerprint(g.valley);
          expect(monthEnglish(day)).toBe(name);
          expect(dateEnglish(day)).toBe(`${date} ${name}`);
          expect(fingerprint(g.valley)).toBe(before);
        }
      }
      doy += length;
    }
  });

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

  it('glosses unfamiliar terms without changing stored words or state', () => {
    const g = newGame(7);
    const before = fingerprint(g.valley);
    const stored = 'Osman the reeve: one sheaf in eight; the flock on the yayla; the pekmez cauldron.';
    required(g.valley.notes[0]).text = stored;
    const withNote = fingerprint(g.valley);
    expect(englishText(stored)).toBe(
      'Osman the reeve (local overseer): one sheaf in eight (one eighth of the harvest as pay); the flock on the yayla (summer highland pasture); the pekmez (grape syrup) cauldron.',
    );
    expect(required(g.valley.notes[0]).text).toBe(stored);
    expect(fingerprint(g.valley)).toBe(withNote);
    expect(before).not.toBe(withNote);
    expect(englishText('Yayla')).toBe('Yayla');
    expect(englishText('a sheaf in eight')).toBe('a sheaf in eight (one eighth of the harvest as pay)');
    expect(englishText(englishText(stored))).toBe(englishText(stored));
  });

  it('uses English dates in run and volume export labels without changing saved state', () => {
    const g = newGame(7);
    for (const [day, date] of [
      [0, '18 July'],
      [18, '5 August'],
      [167, '1 January'],
    ] as const) {
      g.valley.minute = day * DAY;
      const before = fingerprint(g.valley);
      const label = volumeLabel(g.valley, 1);
      expect(label).toBe(`Volume II, ${date} of year ${day === 167 ? 'two' : 'one'}`);
      expect(save(g, 1).label).toBe(label);
      expect(compactRun(g, 1).label).toBe(label);
      expect(fingerprint(g.valley)).toBe(before);
    }
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

describe('remaining-work guidance', () => {
  it.each([230, 256])('does not collect completed shares in season day %i', (doy) => {
    const s = atDoy(doy);
    s.flags.verbs.push('take');
    s.agha.standing = 0;
    s.agha.reaped = 0;
    s.agha.granary = s.agha.due + 20;
    for (const h of s.households) h.paid = shareOwed(h);
    call(
      s,
      'bring-share',
      s.households.map((h) => h.id),
    );
    const before = fingerprint(s);
    expect(nowWords(s)).toMatch(/due is (in|ready)/);
    expect(nowWords(s)).not.toMatch(/standing call|unpaid/);
    expect(nextWords(s)).not.toMatch(/bring in the unpaid|Shares can be called/);
    expect(fingerprint(s)).toBe(before);
  });

  it.each([259, 260, 270, 290, 340, 90])(
    'uses the rider receipt after collection on season day %i',
    (doy) => {
      const s = atDoy(doy);
      s.flags.verbs.push('take');
      s.agha.standing = 0;
      s.agha.reaped = 0;
      s.agha.granary = 20;
      for (const h of s.households) h.paid = shareOwed(h);
      s.notes.push({
        id: 999,
        at: s.agha.dueDay * DAY + 660,
        kind: 'due',
        text: 'The rider loaded the whole due.',
        weight: 3,
      });
      s.agha.delivered = s.agha.due;
      expect(nowWords(s)).toMatch(/due is in/i);
      expect(nextWords(s)).not.toMatch(/rider comes|unpaid shares/i);
      expect(nextWords(s)).toMatch(/winter|hungry|mill|crop/i);
      s.agha.millOpen = true;
      expect(nowWords(s)).toMatch(/mill/);
    },
  );

  it('does not claim a missed due was paid', () => {
    const s = atDoy(270);
    s.agha.missed = 1;
    s.agha.delivered = 10;
    s.agha.granary = 0;
    s.notes.push({ id: 999, at: s.agha.dueDay * DAY + 660, kind: 'due', text: 'short', weight: 3 });
    expect(nowWords(s)).not.toMatch(/due is in|due is ready/i);
    expect(nextWords(s)).not.toMatch(/rider comes on 15 September\./);
  });
});

it('explains completed work and open calls with full return dates', () => {
  const s = atDoy(230);
  s.flags.verbs.push('take');
  const h = required(s.households[0]);
  required(call(s, 'bring-share', [h.id]));
  expect(callUnavailable(s, 'bring-share', h)).toMatch(/expires on.*year one/);
  h.paid = shareOwed(h);
  expect(callUnavailable(s, 'bring-share', h)).toMatch(/25 June, year two/);
  expect(limitsWords(s, h)).toMatch(/25 June, year two/);
  s.agha.standing = 0;
  expect(callUnavailable(s, 'reap-agha')).toMatch(/cut.*30 June, year two/);
  s.agha.millOpen = true;
  s.agha.mill = 600;
  expect(callUnavailable(s, 'build-mill')).toMatch(/complete.*no further/i);
});

it('does not revive collection after a rider receipt leaves the bounded notebook', () => {
  const s = atDoy(270);
  s.flags.verbs.push('take');
  s.agha.standing = 0;
  s.agha.granary = s.agha.due * 2;
  expect(nowWords(s)).not.toMatch(/unpaid|due is ready/);
  expect(nextWords(s)).not.toMatch(/rider comes|unpaid/);
});

it('describes late June renewal as complete and ends renewals with the term', () => {
  const s = atDoy(178);
  expect(nextWords(s)).toMatch(/crop.*(stands|standing)|shares.*renewed/i);
  s.minute = (365 * 2 + 150) * DAY;
  s.agha.standing = 0;
  s.flags.verbs.push('take');
  for (const h of s.households) h.paid = shareOwed(h);
  expect(callUnavailable(s, 'reap-agha')).toMatch(/no further.*term/i);
  expect(callUnavailable(s, 'bring-share')).toMatch(/no further.*term/i);
  expect(limitsWords(s, s.households[0])).not.toMatch(/year four/);
});

it.each([2, 3])('uses the renewed crop rather than last year’s receipt in year %i', (year) => {
  const s = newGame(7).valley;
  s.flags.verbs.push('take');
  s.agha.standing = 0;
  const day = (year - 1) * YEAR_DAYS + 230 - START_DOY;
  s.minute = day * DAY;
  s.agha.dueDay = day + 29;
  s.notes.push({ id: 999, at: (day - 336) * DAY, kind: 'due', text: 'The whole due.', weight: 3 });
  expect(nowWords(s)).toMatch(/unpaid/);
  expect(nextWords(s)).toMatch(/unpaid/);
});

it('does not promise another loan after the term ends', () => {
  const s = newGame(7).valley;
  s.minute = 800 * DAY;
  s.agha.loan = { kile: 80, owe: 100, asked: 790 * DAY, arrives: 802 * DAY };
  expect(limitsWords(s)).toMatch(/rest of your term/);
  expect(limitsWords(s)).not.toMatch(/year four/);
});

it('keeps harvest results, rain deadline and grain date together through calls and visits', () => {
  const s = newGame(7).valley;
  s.agha.reaped = 187;
  s.agha.standing = 123;
  call(s, 'reap-agha', ['coban']);
  const before = fingerprint(s);
  expect(nextWords(s)).toMatch(/about 185 kile are cut.*120 kile are still standing/i);
  expect(nextWords(s)).toMatch(/rain.*20 July/i);
  expect(nextWords(s)).toMatch(/5 August.*grain|grain.*5 August/i);
  expect(nowWords(s)).toMatch(/call.*underway|replies.*available/i);
  s.kahyaState.visit = { house: 'coban', arrive: 30, leave: 90, back: 120 };
  expect(nextWords(s)).toMatch(/185 kile are cut.*120 kile are still standing/);
  delete s.kahyaState.visit;
  expect(fingerprint(s)).toBe(before);
});

it('projects complete dialogue before shorter fragments without changing the saved run', () => {
  const g = newGame(7);
  const before = fingerprint(g.valley);
  expect(englishText('A sheaf in eight. The world is turning.')).toBe(
    'We will receive a sheaf in eight (one eighth of the harvest as pay). Things are changing.',
  );
  expect(englishText('We gave our girl away this month. The house is quieter. Too quiet.')).toBe(
    'Our daughter married this month. The house is quieter. It is too quiet.',
  );
  expect(englishText('Come back in the spring. Not as kahya.')).toBe(
    'Come back in the spring, but do not come as steward.',
  );
  expect(englishText('Put the mill off today: Yusuf and Zehra.')).toBe(
    'Yusuf and Zehra postponed the mill today.',
  );
  expect(englishText('Brought their share today: Yusuf.')).toBe('Yusuf brought their share today.');
  expect(englishText(g.valley.notes[0]?.text ?? '')).toContain('He wants his barley cut before the rains.');
  expect(fingerprint(g.valley)).toBe(before);
});
