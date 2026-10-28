import { describe, expect, it } from 'vitest';
import { DAY, monthEnglish, START_DOY, YEAR_DAYS } from '../src/sim/calendar.ts';
import { compactRun, fingerprint, newGame, save, step, volumeLabel } from '../src/sim/game.ts';
import { call, shareOwed } from '../src/sim/valley.ts';
import {
  callUnavailable,
  dateEnglish,
  englishText,
  limitsWords,
  nextWords,
  nowWords,
  PURPOSE,
  stormReportWords,
  weatherWords,
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
      'Osman the local overseer: one sheaf in eight (one eighth of the harvest as pay); the flock on the summer highland pasture; the grape syrup cauldron.',
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

  it('describes uncut barley and the landowner payment in complete sentences', () => {
    const s = atDoy(198);
    s.agha.reaped = 0;
    s.agha.standing = 360;
    expect(nextWords(s)).toContain('No barley is cut yet.');
    expect(nextWords(s)).toContain('360 grain measures are still in the field.');
    expect(nextWords(s)).toContain('The landowner’s payment must be ready');
    expect(nextWords(s)).not.toMatch(/thresh|The due/);
    s.agha.reaped = 1;
    expect(nextWords(s)).toContain('Less than 5 grain measures are cut.');
    expect(nextWords(s)).not.toContain('No barley is cut yet.');
  });

  it('keeps later harvest guidance consistent with shares already revealed', () => {
    const s = atDoy(198);
    s.flags.verbs.push('take');
    expect(nextWords(s)).toMatch(/while people separate the grain/);
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
    expect(limitsWords(s, h)).toMatch(/still open.*when it ends/);
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
    expect(limitsWords(s, upper)).toMatch(/authority/);
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
  expect(callUnavailable(s, 'bring-share', h)).toMatch(/call again on.*year one/);
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
  expect(callUnavailable(s, 'bring-share')).toMatch(/not renew again.*term/i);
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
  expect(nextWords(s)).toMatch(
    /about 185 grain measures are cut.*120 grain measures are still in the field/i,
  );
  expect(nextWords(s)).toMatch(/rain.*20 July/i);
  expect(nextWords(s)).toMatch(/5 August.*grain|grain.*5 August/i);
  expect(nowWords(s)).toMatch(/call.*underway|replies.*available/i);
  s.kahyaState.visit = { house: 'coban', arrive: 30, leave: 90, back: 120 };
  expect(nextWords(s)).toMatch(/185 grain measures are cut.*120 grain measures are still in the field/);
  delete s.kahyaState.visit;
  expect(fingerprint(s)).toBe(before);
});

it('authors complete opening text without a display rewrite', () => {
  const g = newGame(7);
  const before = fingerprint(g.valley);
  const opening = g.valley.notes[0]?.text ?? '';
  expect(opening).toContain('He wants his barley cut before the rains.');
  expect(opening).toContain('grain measures');
  expect(englishText(opening)).toBe(opening);
  expect(g.valley.households.find((h) => h.id === 'kara')?.looks).toBe(
    'A young family lives here. The roof is partly repaired. A baby cries most evenings.',
  );
  expect(fingerprint(g.valley)).toBe(before);
});

it('keeps forecasts separate from current weather and future-dated damage reports', () => {
  const g = newGame(7);
  const s = g.valley;
  expect(weatherWords(s)).toBe('Rain is expected on 20 July.');
  expect(nextWords(s)).toContain('Rain is expected on 20 July.');
  step(g, DAY + 23 * 60);
  expect(weatherWords(s)).toBe('Rain is expected on 20 July.');
  step(g, 2 * DAY);
  expect(weatherWords(s)).toBe('There is a storm today.');
  expect(nextWords(s)).not.toMatch(/expected on 20 July|before more rain/);
  // Midnight has applied damage, but the public report is dated 05:00.
  expect(s.notes.some((n) => n.text.includes('about 108 grain measures'))).toBe(true);
  expect(stormReportWords(s)).toEqual([]);
  step(g, 2 * DAY + 5 * 60);
  const report = s.notes.find((n) => n.text.startsWith('The storm came over the ridge'));
  expect(report?.text).toContain('about 108 grain measures in the landowner’s field');
  expect(report?.text).toContain('14 household fields');
  expect(stormReportWords(s)).toEqual([`20 July, year one: ${report?.text}`]);
  step(g, 3 * DAY);
  const before = JSON.stringify(s);
  expect(weatherWords(s)).not.toMatch(/expected|20 July|before more rain/);
  expect(nextWords(s)).not.toMatch(/expected on 20 July|before more rain/);
  expect(stormReportWords(s)).toEqual([`20 July, year one: ${report?.text}`]);
  expect(JSON.stringify(s)).toBe(before);
});

it('does not reconstruct storm loss from stocks or claim zero when reports are missing', () => {
  const g = newGame(7);
  step(g, 3 * DAY);
  const s = g.valley;
  const original = stormReportWords(s);
  // Harvested, spent and gifted grain cannot change an earlier reported loss.
  s.agha.reaped += 50;
  s.agha.granary = 0;
  s.agha.standing = 0;
  expect(stormReportWords(s)).toEqual(original);
  s.notes = s.notes.filter((n) => n.kind !== 'weather');
  expect(stormReportWords(s)).toEqual([]);
  s.minute = 365 * DAY;
  expect(weatherWords(s)).not.toMatch(/expected.*20 July/);
});
