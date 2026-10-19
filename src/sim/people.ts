/**
 * The valley's households and their people. Everyone is an HF `Person`; this module only says who they are at the
 * start (traits, values, norms, habits, ties, trust in the kahya's office) and never keeps a parallel model of their
 * minds. The lower hamlet is written by hand so that its stories are reliable (the reeve and his brother, the
 * shepherd whose wife is near her time, the widow the last kahya wronged); the upper hamlet is rolled from the seed.
 */
import {
  createPerson,
  enablePromptings,
  MINUTES_PER_YEAR,
  MUSLIM_CUSTOM,
  marry,
  type Person,
  type PersonSpec,
  promise,
  remember,
  seedTie,
} from '@adam0white/human-framework';
import { DAY } from './calendar.ts';
import { hashUnit, mixSeed } from './rng.ts';

export const KAHYA = 'kahya';
export type Hamlet = 'lower' | 'upper';

export interface Field {
  /** Grain still standing, kile. */
  standing: number;
  /** Reaped and stooked, waiting for the threshing floor, kile. */
  reaped: number;
  /** Sown for next year, 0..1 of the field. */
  sown: number;
  /** Size, in kile of a good year's crop. */
  size: number;
}

export interface Household {
  id: string;
  /** The house's name as the valley says it: "the Ak house". */
  name: string;
  /** Short name: "Ak". */
  short: string;
  hamlet: Hamlet;
  /** Map position of the house, 0..1000 on both axes. */
  x: number;
  y: number;
  /** Map position of the field. */
  fx: number;
  fy: number;
  field: Field;
  /** Grain in the house, kile (world truth; the kahya only guesses it). */
  store: number;
  /** What the house owes the agha each year, kile, as the last kahya's ledger has it. */
  share: number;
  /** Brought this year. */
  paid: number;
  /** Share eased (an exemption) this year. */
  eased: boolean;
  /** Living members, head first. */
  members: string[];
  /** People who left for the city or died, with the day. */
  gone: { id: string; day: number; why: 'left' | 'died' | 'married-out' }[];
  /** What the house is known for (one line the kahya can see for himself). */
  looks: string;
}

interface Who {
  id: string;
  name: string;
  age: number;
  sex: 'male' | 'female';
  traits?: PersonSpec['traits'];
  values?: PersonSpec['values'];
  trust?: number;
  devout?: boolean;
  skills?: Record<string, number>;
  body?: PersonSpec['body'];
}

const NORMS = (devout: boolean, honesty: number) => [
  { normId: 'theft', standing: 'forbidden' as const, conviction: 0.6 + 0.35 * honesty },
  { normId: 'salah', standing: 'obligatory' as const, conviction: devout ? 0.85 : 0.35 },
  // Engineering assumption: the share is an agreed obligation (fulfilling contracts), held as each person understands it.
  { normId: 'dues', standing: 'obligatory' as const, conviction: 0.1 + 0.5 * honesty },
];

export function makePerson(w: Who, seed: number, now: number, household: string): Person {
  const honesty = w.traits?.honesty ?? 0.5;
  const spec: PersonSpec = {
    id: w.id,
    name: w.name,
    seed: mixSeed(seed, w.id.length, w.id.charCodeAt(0), w.id.charCodeAt(w.id.length - 1), w.age),
    now,
    bornAt: now - Math.round((w.age + hashUnit(seed, w.age, w.id.length) * 0.9) * MINUTES_PER_YEAR),
    sex: w.sex,
    traits: { ...w.traits },
    values: { tradition: 0.6, security: 0.7, conformity: 0.55, benevolence: 0.6, ...w.values },
    norms: w.age >= 12 ? NORMS(w.devout ?? false, honesty) : [],
    skills: { farming: w.age >= 14 ? 0.45 + 0.3 * Math.min(1, (w.age - 14) / 20) : 0.1, ...w.skills },
    voices: [{ voiceId: KAHYA, trust: w.trust ?? 0.45 }],
    retention: { trace: 0, chronicleDays: 31 },
    enable: w.age >= 14 ? { fatigueStore: true, review: { style: 'accounting', at: 21 * 60 + 30 } } : {},
  };
  if (w.body) spec.body = w.body;
  const p = createPerson(spec);
  // A home they know: where they eat, sleep and are found.
  p.habits.push({
    cue: { placeId: `house:${household}` },
    action: 'sleep',
    strength: 0.4,
    repetitions: 3000,
    lastAt: now,
  });
  if (w.devout && w.age >= 14) {
    // Maghrib at the mosque or at home: a quiet part of the day, kept by those who keep it.
    promise(p, {
      kind: 'worship',
      toId: 'self',
      label: 'the evening prayer',
      actions: ['pray'],
      normId: 'salah',
      from: Math.floor(now / DAY) * DAY + 19 * 60 + 40,
      until: Math.floor(now / DAY) * DAY + 21 * 60,
      importance: 0.5,
      recurEvery: DAY,
    });
  }
  return p;
}

interface HouseSpec {
  id: string;
  short: string;
  hamlet: Hamlet;
  x: number;
  y: number;
  fx: number;
  fy: number;
  size: number;
  store: number;
  share: number;
  looks: string;
  people: Who[];
}

/** The lower hamlet, by hand. Ages are at the start of play. */
const LOWER: HouseSpec[] = [
  {
    id: 'kavak',
    short: 'Kavak',
    hamlet: 'lower',
    x: 470,
    y: 560,
    fx: 560,
    fy: 640,
    size: 114,
    store: 20,
    share: 23,
    looks: 'The reeve’s house: whitewashed, the only one with glass in a window.',
    people: [
      {
        id: 'osman',
        name: 'Osman',
        age: 52,
        sex: 'male',
        trust: 0.6,
        devout: true,
        traits: { honesty: 0.35, conscientiousness: 0.75, agreeableness: 0.45, extraversion: 0.65 },
        values: { power: 0.7, security: 0.8, conformity: 0.6 },
      },
      {
        id: 'hatice',
        name: 'Hatice',
        age: 47,
        sex: 'female',
        trust: 0.5,
        devout: true,
        traits: { honesty: 0.7, agreeableness: 0.6 },
      },
      {
        id: 'ali',
        name: 'Ali',
        age: 22,
        sex: 'male',
        trust: 0.5,
        traits: { extraversion: 0.6, conscientiousness: 0.5, openness: 0.6 },
      },
      {
        id: 'emine',
        name: 'Emine',
        age: 17,
        sex: 'female',
        trust: 0.5,
        traits: { conscientiousness: 0.6, emotionality: 0.6 },
      },
    ],
  },
  {
    id: 'ak',
    short: 'Ak',
    hamlet: 'lower',
    x: 420,
    y: 600,
    fx: 360,
    fy: 690,
    size: 114,
    store: 10,
    share: 23,
    looks: 'Osman’s brother’s house. Three boys’ shirts on the line.',
    people: [
      {
        id: 'hasan',
        name: 'Hasan',
        age: 44,
        sex: 'male',
        trust: 0.55,
        traits: { honesty: 0.65, conscientiousness: 0.7, agreeableness: 0.6 },
      },
      {
        id: 'fatma',
        name: 'Fatma',
        age: 40,
        sex: 'female',
        trust: 0.5,
        devout: true,
        traits: { conscientiousness: 0.7 },
      },
      { id: 'ismail', name: 'İsmail', age: 15, sex: 'male', trust: 0.5 },
      { id: 'kadir', name: 'Kadir', age: 12, sex: 'male' },
      { id: 'sultan', name: 'Sultan', age: 8, sex: 'female' },
    ],
  },
  {
    id: 'coban',
    short: 'Çoban',
    hamlet: 'lower',
    x: 330,
    y: 520,
    fx: 270,
    fy: 600,
    size: 76,
    store: 3,
    share: 15,
    looks: 'The shepherd’s house at the edge, a dog on a chain, the flock up on the yayla.',
    people: [
      {
        id: 'yusuf',
        name: 'Yusuf',
        age: 38,
        sex: 'male',
        trust: 0.4,
        traits: { honesty: 0.75, agreeableness: 0.4, extraversion: 0.3, emotionality: 0.55 },
        values: { benevolence: 0.8, autonomy: 0.7 } as PersonSpec['values'],
      },
      { id: 'zehra', name: 'Zehra', age: 31, sex: 'female', trust: 0.4, body: { fitness: 0.4 } },
      { id: 'cemal', name: 'Cemal', age: 9, sex: 'male' },
      { id: 'gul', name: 'Gül', age: 6, sex: 'female' },
    ],
  },
  {
    id: 'dere',
    short: 'Dere',
    hamlet: 'lower',
    x: 540,
    y: 470,
    fx: 640,
    fy: 520,
    size: 34,
    store: 4,
    share: 7,
    looks: 'Widow Saliha’s house by the stream. The ox stall is empty.',
    people: [
      {
        id: 'saliha',
        name: 'Saliha',
        age: 58,
        sex: 'female',
        trust: 0.22,
        devout: true,
        traits: { honesty: 0.9, agreeableness: 0.3, conscientiousness: 0.8, emotionality: 0.4 },
      },
      {
        id: 'musa',
        name: 'Musa',
        age: 26,
        sex: 'male',
        trust: 0.3,
        traits: { honesty: 0.7, conscientiousness: 0.65, extraversion: 0.35 },
      },
    ],
  },
  {
    id: 'kara',
    short: 'Kara',
    hamlet: 'lower',
    x: 380,
    y: 470,
    fx: 300,
    fy: 420,
    size: 54,
    store: 3,
    share: 11,
    looks: 'A young house, roof half-mended. A baby crying most evenings.',
    people: [
      {
        id: 'mustafa',
        name: 'Mustafa',
        age: 30,
        sex: 'male',
        trust: 0.5,
        traits: { honesty: 0.55, conscientiousness: 0.45, extraversion: 0.7, openness: 0.7 },
        values: { achievement: 0.75, stimulation: 0.6 } as PersonSpec['values'],
      },
      { id: 'elif', name: 'Elif', age: 26, sex: 'female', trust: 0.45, traits: { emotionality: 0.65 } },
      { id: 'bebek', name: 'Nuri', age: 1, sex: 'male' },
    ],
  },
  {
    id: 'demirci',
    short: 'Demirci',
    hamlet: 'lower',
    x: 500,
    y: 640,
    fx: 470,
    fy: 740,
    size: 104,
    store: 8,
    share: 21,
    looks: 'The smithy. The old man still swings the hammer; his son does the rest.',
    people: [
      {
        id: 'ibrahim',
        name: 'İbrahim',
        age: 63,
        sex: 'male',
        trust: 0.5,
        devout: true,
        traits: { honesty: 0.8, conscientiousness: 0.8, agreeableness: 0.65 },
        skills: { smithing: 0.85 },
      },
      { id: 'havva', name: 'Havva', age: 60, sex: 'female', trust: 0.5, devout: true },
      {
        id: 'halil',
        name: 'Halil',
        age: 31,
        sex: 'male',
        trust: 0.45,
        skills: { smithing: 0.6 },
        traits: { conscientiousness: 0.6 },
      },
      { id: 'meryem', name: 'Meryem', age: 24, sex: 'female', trust: 0.45 },
      { id: 'ahmet', name: 'Ahmet', age: 2, sex: 'male' },
    ],
  },
  {
    id: 'kuyucu',
    short: 'Kuyucu',
    hamlet: 'lower',
    x: 640,
    y: 600,
    fx: 700,
    fy: 650,
    size: 91,
    store: 8,
    share: 18,
    looks: 'The well-digger’s house. Two daughters, and the whole lane knows it.',
    people: [
      {
        id: 'omer',
        name: 'Ömer',
        age: 48,
        sex: 'male',
        trust: 0.45,
        traits: { honesty: 0.6, conscientiousness: 0.55, agreeableness: 0.7 },
      },
      { id: 'gulsum', name: 'Gülsüm', age: 45, sex: 'female', trust: 0.45, devout: true },
      {
        id: 'esma',
        name: 'Esma',
        age: 19,
        sex: 'female',
        trust: 0.5,
        traits: { extraversion: 0.65, openness: 0.65 },
      },
      { id: 'hanife', name: 'Hanife', age: 15, sex: 'female', trust: 0.5 },
    ],
  },
  {
    id: 'tepe',
    short: 'Tepe',
    hamlet: 'lower',
    x: 430,
    y: 420,
    fx: 470,
    fy: 340,
    size: 68,
    store: 6,
    share: 14,
    looks: 'Up the slope. The son is at the coffeehouse more than at the plough.',
    people: [
      {
        id: 'recep',
        name: 'Recep',
        age: 29,
        sex: 'male',
        trust: 0.4,
        traits: { honesty: 0.45, conscientiousness: 0.3, extraversion: 0.8, agreeableness: 0.55 },
      },
      {
        id: 'serife',
        name: 'Şerife',
        age: 63,
        sex: 'female',
        trust: 0.45,
        devout: true,
        body: { fitness: 0.35 },
      },
      {
        id: 'zeynep',
        name: 'Zeynep',
        age: 21,
        sex: 'female',
        trust: 0.45,
        traits: { conscientiousness: 0.75, honesty: 0.7, extraversion: 0.55 },
      },
    ],
  },
];

const MALE = [
  'Mehmet',
  'Hüseyin',
  'Mahmut',
  'Bekir',
  'Veli',
  'Rıza',
  'Salih',
  'Ramazan',
  'Davut',
  'Süleyman',
  'Kâmil',
  'Yakup',
  'Zeki',
  'Nazım',
  'Cafer',
  'Hamza',
];
const FEMALE = [
  'Ayşe',
  'Hacer',
  'Fadime',
  'Esra',
  'Nuriye',
  'Dürdane',
  'Gülizar',
  'Rukiye',
  'Cennet',
  'Halime',
  'Nazlı',
  'Safiye',
  'Hayriye',
  'Sevda',
  'Asiye',
  'Kezban',
];
const UPPER_HOUSES = [
  { id: 'yayla', short: 'Yayla', looks: 'Highest house in the valley; they come down only for the mill.' },
  { id: 'ceviz', short: 'Ceviz', looks: 'An old walnut over the door, and a feud with someone below.' },
  { id: 'pinar', short: 'Pınar', looks: 'By the upper spring. The women of the upper lanes meet here.' },
  { id: 'uzun', short: 'Uzun', looks: 'Tall men, all of them, and a mother who decides.' },
  { id: 'topal', short: 'Topal', looks: 'The father limps from the old levy. He does not speak of it.' },
  { id: 'sari', short: 'Sarı', looks: 'New roof tiles. Someone sends money from the city.' },
];
const UPPER_POS = [
  [560, 230, 640, 180],
  [470, 250, 400, 190],
  [620, 300, 700, 260],
  [520, 310, 560, 380],
  [420, 300, 340, 260],
  [680, 220, 760, 160],
];

/** The upper hamlet, rolled from the seed: six houses with no history with you. */
function upperHouses(seed: number): HouseSpec[] {
  const out: HouseSpec[] = [];
  let mi = 0;
  let fi = 0;
  UPPER_HOUSES.forEach((h, i) => {
    const r = (k: number) => hashUnit(seed, 3, i, k);
    const [x, y, fx, fy] = (UPPER_POS[i] ?? [500, 250, 500, 200]) as [number, number, number, number];
    const sizeDraw = r(1);
    const headAge = Math.round(32 + 30 * r(2));
    const people: Who[] = [];
    const hid = `${h.id}-${MALE[mi % MALE.length]?.toLowerCase() ?? 'x'}`;
    const male = r(3) > 0.15;
    const trait = (k: number) => 0.25 + 0.5 * r(10 + k);
    people.push({
      id: hid,
      name: male ? (MALE[mi++ % MALE.length] ?? 'Mehmet') : (FEMALE[fi++ % FEMALE.length] ?? 'Ayşe'),
      age: headAge,
      sex: male ? 'male' : 'female',
      trust: 0.3 + 0.25 * r(4),
      devout: r(5) > 0.5,
      traits: {
        honesty: trait(1),
        conscientiousness: trait(2),
        agreeableness: trait(3),
        extraversion: trait(4),
        emotionality: trait(5),
      },
    });
    if (male && headAge < 60) {
      people.push({
        id: `${h.id}-w`,
        name: FEMALE[fi++ % FEMALE.length] ?? 'Ayşe',
        age: headAge - 3 - Math.round(4 * r(6)),
        sex: 'female',
        trust: 0.35 + 0.2 * r(7),
        devout: r(8) > 0.4,
      });
    }
    const kids = Math.floor(r(9) * 4);
    for (let k = 0; k < kids; k++) {
      const age = Math.max(0, Math.round(headAge - 22 - k * 3 - 4 * r(20 + k)));
      const boy = r(30 + k) > 0.5;
      people.push({
        id: `${h.id}-c${k}`,
        name: boy ? (MALE[mi++ % MALE.length] ?? 'Ali') : (FEMALE[fi++ % FEMALE.length] ?? 'Ayşe'),
        age,
        sex: boy ? 'male' : 'female',
        trust: 0.4,
      });
    }
    out.push({
      id: h.id,
      short: h.short,
      hamlet: 'upper',
      x,
      y,
      fx,
      fy,
      // Sized to the mouths: from a little short to comfortable, after seed and share (about 0.58 of a field).
      size: Math.round((people.length * 11 * (0.85 + 0.6 * sizeDraw)) / 0.58),
      store: Math.round(people.length * 11 * (0.05 + 0.2 * r(40))),
      share: Math.round((people.length * 11 * (0.85 + 0.6 * sizeDraw) * 0.2) / 0.58),
      looks: h.looks,
      people,
    });
  });
  return out;
}

export interface Founded {
  households: Household[];
  people: Person[];
}

/** Found the valley at minute `now`. */
export function foundValley(seed: number, now: number): Founded {
  const specs = [...LOWER, ...upperHouses(seed)];
  const households: Household[] = [];
  const people: Person[] = [];
  for (const h of specs) {
    const hp = h.people.map((w) => makePerson(w, seed, now, h.id));
    // Kin: everyone in a house is family; spouses and parents are marked.
    const head = hp[0];
    for (const a of hp) {
      for (const b of hp) {
        if (a === b) continue;
        const roles: string[] = [];
        const wa = h.people.find((w) => w.id === a.id);
        const wb = h.people.find((w) => w.id === b.id);
        if (!wa || !wb) continue;
        const spouses =
          (a === head || b === head) &&
          wa.sex !== wb.sex &&
          Math.abs(wa.age - wb.age) < 15 &&
          wa.age >= 18 &&
          wb.age >= 18 &&
          !(h.id === 'tepe' || h.id === 'dere');
        if (spouses) {
          if (a.id < b.id) marry(a, b, now, MUSLIM_CUSTOM);
          continue;
        }
        if (wa.age - wb.age >= 16) roles.push('child');
        else if (wb.age - wa.age >= 16) roles.push('parent');
        else roles.push('sibling');
        seedTie(a, { otherId: b.id, roles, affection: 0.7, familiarity: 0.95, trust: 0.75 });
      }
    }
    people.push(...hp);
    households.push({
      id: h.id,
      name: `the ${h.short} house`,
      short: h.short,
      hamlet: h.hamlet,
      x: h.x,
      y: h.y,
      fx: h.fx,
      fy: h.fy,
      field: {
        standing: Math.round(h.size * 0.75),
        reaped: Math.round(h.size * 0.25),
        sown: 0,
        size: h.size,
      },
      store: h.store,
      share: h.share,
      paid: 0,
      eased: false,
      members: hp.map((p) => p.id),
      gone: [],
      looks: h.looks,
    });
  }
  const byId = new Map(people.map((p) => [p.id, p]));
  const tie = (a: string, b: string, roles: string[], affection: number, trust: number) => {
    const pa = byId.get(a);
    const pb = byId.get(b);
    if (!pa || !pb) return;
    seedTie(pa, { otherId: b, roles, affection, familiarity: 0.9, trust });
    seedTie(pb, { otherId: a, roles, affection, familiarity: 0.9, trust });
  };
  // Osman and Hasan are brothers.
  tie('osman', 'hasan', ['sibling'], 0.6, 0.6);
  // Neighbours in the lower hamlet know each other well.
  const lower = households.filter((h) => h.hamlet === 'lower');
  for (const a of lower) {
    for (const b of lower) {
      if (a === b) continue;
      const ha = byId.get(a.members[0] ?? '');
      if (!ha) continue;
      const hb = b.members[0];
      if (!hb || ha.social.relationships.some((r) => r.otherId === hb)) continue;
      seedTie(ha, { otherId: hb, roles: ['neighbor'], affection: 0.3, familiarity: 0.7, trust: 0.5 });
    }
  }
  // Ali and Esma: the whole lane knows.
  tie('ali', 'esma', ['neighbor'], 0.55, 0.6);
  // Zehra is near her time: it is due in the first days.
  const zehra = byId.get('zehra');
  if (zehra) {
    zehra.family = {
      ...(zehra.family ?? {}),
      pregnancy: {
        fatherId: 'yusuf',
        conceivedAt: now - 268 * DAY,
        dueAt: now + 2 * DAY + 9 * 60,
        seed: mixSeed(seed, 77),
      },
    };
  }
  // The last kahya took Saliha's ox for the agha's arrears, the spring her husband died.
  const saliha = byId.get('saliha');
  if (saliha) {
    remember(saliha, {
      at: now - 120 * DAY,
      kind: 'harm',
      actorId: KAHYA,
      targetId: 'saliha',
      valence: -0.8,
      salience: 0.9,
      summary: 'the kahya took our ox for the agha’s arrears',
      tags: ['kahya', 'loss'],
    });
  }
  // Recep's coffeehouse habit.
  const recep = byId.get('recep');
  if (recep)
    recep.habits.push({
      cue: { placeId: 'coffeehouse' },
      action: 'chat',
      strength: 0.55,
      repetitions: 1500,
      lastAt: now,
    });
  // Mustafa has heard what the city pays. A pull he holds back from, for now.
  const mustafa = byId.get('mustafa');
  if (mustafa) enablePromptings(mustafa, { reading: 'inclination', readingSource: 'host:mustafa' });
  return { households, people };
}

/** Make the kahya: the player's own person. Only their body, age and impressions are used. */
export function makeKahya(seed: number, now: number): Person {
  return createPerson({
    id: KAHYA,
    name: 'the kahya',
    seed: mixSeed(seed, 0x4a),
    now,
    bornAt: now - 41 * MINUTES_PER_YEAR,
    sex: 'male',
    traits: { conscientiousness: 0.6 },
    retention: { trace: 0, chronicleDays: 31 },
    enable: { fatigueStore: true },
  });
}
