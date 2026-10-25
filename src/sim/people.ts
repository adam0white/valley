/**
 * The valley's households and their people. Everyone is an HF `Person`; this module only says who they are at the
 * start (traits, values, norms, habits, ties, trust in the kahya's office) and never keeps a parallel model of their
 * minds. The lower hamlet is written by hand so that its stories are reliable (incidental household roles and the
 * canonical builder whose wife is near her time); the upper hamlet is rolled from the seed.
 */
import {
  createPerson,
  MINUTES_PER_YEAR,
  MUSLIM_CUSTOM,
  marry,
  type Person,
  type PersonSpec,
  promise,
  seedTie,
} from '@adam0white/human-framework';
import { DAY } from './calendar.ts';
import { canonicalOpening } from './cast.ts';
import { hashUnit, mixSeed } from './rng.ts';

/** Lodging names shown to the player; saved household names remain unchanged. */
export function householdLabel(h: Pick<Household, 'name'> & Partial<Pick<Household, 'id'>>): string {
  if (h.id === 'water-guest') return 'Danyal’s lodging';
  if (h.id === 'guests') return 'the survey visitors’ lodging';
  return h.name;
}

/** A readable role label without changing the person's saved name. */
export function personLabel(
  p: Pick<Person, 'name'>,
  h?: Pick<Household, 'name'> & Partial<Pick<Household, 'id'>>,
): string {
  if (p.name === 'the reeve') return 'the local overseer';
  if (p.name === 'a household member' || p.name === 'a child') {
    const role = p.name === 'a child' ? 'a child' : 'someone';
    return h ? `${role} from ${householdLabel(h)}` : role;
  }
  return p.name;
}

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
  christian?: boolean;
}

const NORMS = (devout: boolean, honesty: number, christian = false) => [
  { normId: 'theft', standing: 'forbidden' as const, conviction: 0.6 + 0.35 * honesty },
  ...(christian
    ? []
    : [{ normId: 'salah', standing: 'obligatory' as const, conviction: devout ? 0.85 : 0.35 }]),
  // Engineering assumption: the share is an agreed obligation (fulfilling contracts), held as each person understands it.
  { normId: 'dues', standing: 'obligatory' as const, conviction: 0.1 + 0.5 * honesty },
];

export function makePerson(w: Who, seed: number, now: number, household: string): Person {
  const canonical = canonicalOpening(w.id);
  const honesty = canonical?.traits.honesty ?? w.traits?.honesty ?? 0.5;
  const spec: PersonSpec = {
    id: w.id,
    name: w.name,
    seed: mixSeed(seed, w.id.length, w.id.charCodeAt(0), w.id.charCodeAt(w.id.length - 1), w.age),
    now,
    bornAt:
      now -
      Math.round(
        (canonical ? canonical.age : w.age + hashUnit(seed, w.age, w.id.length) * 0.9) * MINUTES_PER_YEAR,
      ),
    sex: w.sex,
    traits: canonical?.traits ?? { ...w.traits },
    values: canonical?.values ?? {
      tradition: 0.6,
      security: 0.7,
      conformity: 0.55,
      benevolence: 0.6,
      ...w.values,
    },
    norms: w.age >= 12 ? NORMS(w.devout ?? false, honesty, w.christian) : [],
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
    looks: 'The local overseer lives in this whitewashed house. It is the only house with a glass window.',
    people: [
      {
        id: 'osman',
        name: 'the reeve',
        age: 52,
        sex: 'male',
        trust: 0.6,
        devout: true,
        traits: { honesty: 0.35, conscientiousness: 0.75, agreeableness: 0.45, extraversion: 0.65 },
        values: { power: 0.7, security: 0.8, conformity: 0.6 },
      },
      {
        id: 'hatice',
        name: 'a household member',
        age: 47,
        sex: 'female',
        trust: 0.5,
        devout: true,
        traits: { honesty: 0.7, agreeableness: 0.6 },
      },
      {
        id: 'ali',
        name: 'a household member',
        age: 22,
        sex: 'male',
        trust: 0.5,
        traits: { extraversion: 0.6, conscientiousness: 0.5, openness: 0.6 },
      },
      {
        id: 'emine',
        name: 'a child',
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
    looks: 'The Ak family lives here. Three boys’ shirts hang on the line.',
    people: [
      {
        id: 'hasan',
        name: 'a household member',
        age: 44,
        sex: 'male',
        trust: 0.55,
        traits: { honesty: 0.65, conscientiousness: 0.7, agreeableness: 0.6 },
      },
      {
        id: 'fatma',
        name: 'a household member',
        age: 40,
        sex: 'female',
        trust: 0.5,
        devout: true,
        traits: { conscientiousness: 0.7 },
      },
      { id: 'ismail', name: 'a child', age: 15, sex: 'male', trust: 0.5 },
      { id: 'kadir', name: 'a child', age: 12, sex: 'male' },
      { id: 'sultan', name: 'a child', age: 8, sex: 'female' },
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
    looks:
      'Yusuf, 34, builds for the valley and tends the flock part-time. His wife Zehra will soon give birth. His mother Maryam, 68, is visiting to cook. His son Tariq is away at the Well. Zehra is Tariq’s stepmother.',
    people: [
      {
        id: 'yusuf',
        name: 'Yusuf',
        age: 34,
        devout: true,
        skills: { building: 0.75 },
        sex: 'male',
        trust: 0.4,
      },
      { id: 'zehra', name: 'Zehra', age: 31, sex: 'female', trust: 0.4, body: { fitness: 0.4 } },
      { id: 'cemal', name: 'a child', age: 9, sex: 'male' },
      { id: 'gul', name: 'a child', age: 6, sex: 'female' },
      { id: 'maryam', name: 'Hajja Maryam', age: 68, sex: 'female', devout: true, skills: { cooking: 0.85 } },
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
    looks: 'The Dere family lives by the stream. Their ox stall is empty.',
    people: [
      {
        id: 'saliha',
        name: 'a household member',
        age: 58,
        sex: 'female',
        trust: 0.22,
        devout: true,
        traits: { honesty: 0.9, agreeableness: 0.3, conscientiousness: 0.8, emotionality: 0.4 },
      },
      {
        id: 'musa',
        name: 'a household member',
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
    looks: 'A young family lives here. The roof is partly repaired. A baby cries most evenings.',
    people: [
      {
        id: 'mustafa',
        name: 'a household member',
        age: 30,
        sex: 'male',
        trust: 0.5,
        traits: { honesty: 0.55, conscientiousness: 0.45, extraversion: 0.7, openness: 0.7 },
        values: { achievement: 0.75, stimulation: 0.6 } as PersonSpec['values'],
      },
      {
        id: 'elif',
        name: 'a household member',
        age: 26,
        sex: 'female',
        trust: 0.45,
        traits: { emotionality: 0.65 },
      },
      { id: 'bebek', name: 'a child', age: 1, sex: 'male' },
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
    looks: 'This is the smithy. The old man still swings the hammer. His son does the rest.',
    people: [
      {
        id: 'ibrahim',
        name: 'a household member',
        age: 63,
        sex: 'male',
        trust: 0.5,
        devout: true,
        traits: { honesty: 0.8, conscientiousness: 0.8, agreeableness: 0.65 },
        skills: { smithing: 0.85 },
      },
      { id: 'havva', name: 'a household member', age: 60, sex: 'female', trust: 0.5, devout: true },
      {
        id: 'halil',
        name: 'a household member',
        age: 31,
        sex: 'male',
        trust: 0.45,
        skills: { smithing: 0.6 },
        traits: { conscientiousness: 0.6 },
      },
      { id: 'meryem', name: 'a household member', age: 24, sex: 'female', trust: 0.45 },
      { id: 'ahmet', name: 'a child', age: 2, sex: 'male' },
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
    looks: 'The well-digger lives here with his two daughters. Everyone in the lane knows them.',
    people: [
      {
        id: 'omer',
        name: 'a household member',
        age: 48,
        sex: 'male',
        trust: 0.45,
        traits: { honesty: 0.6, conscientiousness: 0.55, agreeableness: 0.7 },
      },
      { id: 'gulsum', name: 'a household member', age: 45, sex: 'female', trust: 0.45, devout: true },
      {
        id: 'esma',
        name: 'a household member',
        age: 19,
        sex: 'female',
        trust: 0.5,
        traits: { extraversion: 0.65, openness: 0.65 },
      },
      { id: 'hanife', name: 'a child', age: 15, sex: 'female', trust: 0.5 },
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
    looks:
      'This house is up the slope. The son spends more time at the coffeehouse than working in the fields.',
    people: [
      {
        id: 'recep',
        name: 'a household member',
        age: 29,
        sex: 'male',
        trust: 0.4,
        traits: { honesty: 0.45, conscientiousness: 0.3, extraversion: 0.8, agreeableness: 0.55 },
      },
      {
        id: 'serife',
        name: 'a household member',
        age: 63,
        sex: 'female',
        trust: 0.45,
        devout: true,
        body: { fitness: 0.35 },
      },
      {
        id: 'zeynep',
        name: 'a household member',
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
  {
    id: 'yayla',
    short: 'Yayla',
    looks: 'This is the highest house in the valley. The family comes down only for the mill.',
  },
  {
    id: 'ceviz',
    short: 'Ceviz',
    looks: 'An old walnut tree grows over the door. This family has a feud with someone in the lower hamlet.',
  },
  {
    id: 'pinar',
    short: 'Pınar',
    looks: 'This house is by the upper spring. The women of the upper lanes meet here.',
  },
  {
    id: 'uzun',
    short: 'Uzun',
    looks: 'All the men in this house are tall. Their mother makes the decisions.',
  },
  {
    id: 'topal',
    short: 'Topal',
    looks: 'The father limps because of an injury from his forced service. He does not speak of it.',
  },
  { id: 'sari', short: 'Sarı', looks: 'The roof has new tiles. Someone sends money from the city.' },
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

/** Visiting roles; departure mechanics remain pending the released chapter contract. No inferred host-family kinship. */
const VISITORS: HouseSpec[] = [
  {
    id: 'guests',
    short: 'Guest',
    hamlet: 'lower',
    x: 590,
    y: 540,
    fx: 590,
    fy: 540,
    size: 0,
    store: 9,
    share: 0,
    looks:
      'These visitors are staying for the survey season. Yusuf Usta, 74, advises on digging; his title means master craftsman. His granddaughter Meryem, 19, helps with surveys. Samira, 29, gathers supplies and advises on food stores. Her husband Idris and children Lena and Pell have care arranged at home. The visitors brought food for a season. Their stay lasts thirty days. They will finish any current work that can be finished before their stay ends. Their duties will remain in their home records. Nobody has promised paid survey work. These guests come from different families.',
    people: [
      {
        id: 'yusuf-usta',
        name: 'Yusuf Usta',
        age: 74,
        sex: 'male',
        body: { fitness: 0.3 },
        skills: { digging: 0.85 },
      },
      { id: 'meryem-visitor', name: 'Meryem', age: 19, sex: 'female', skills: { surveying: 0.3 } },
      { id: 'samira', name: 'Samira', age: 29, sex: 'female', skills: { gathering: 0.7 } },
    ],
  },
  {
    id: 'water-guest',
    short: 'Water guest',
    hamlet: 'lower',
    x: 650,
    y: 500,
    fx: 650,
    fy: 500,
    size: 0,
    store: 3,
    share: 0,
    looks:
      'Danyal, 52, is a visiting well keeper and Christian widower. He lodges separately with his own grain. He and Maryam are old friends. He brought food for a season. His stay ends after thirty days, once his current work can safely stop. His duties will remain in his home records. The game does not show his journey home.',
    people: [
      { id: 'danyal', name: 'Danyal', age: 52, sex: 'male', christian: true, skills: { waterwork: 0.8 } },
    ],
  },
];

export interface Founded {
  households: Household[];
  people: Person[];
}

/** Found the valley at minute `now`. */
export function foundValley(seed: number, now: number): Founded {
  const specs = [...LOWER, ...VISITORS, ...upperHouses(seed)];
  const households: Household[] = [];
  const people: Person[] = [];
  for (const h of specs) {
    const hp = h.people.map((w) => makePerson(w, seed, now, h.id));
    // Kin: everyone in a house is family; spouses and parents are marked.
    const head = hp[0];
    for (const a of hp) {
      for (const b of hp) {
        if (a === b) continue;
        if (h.id === 'guests' || a.id === 'maryam' || b.id === 'maryam') continue;
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
  // Neighbours in the lower hamlet know each other well.
  const lower = households.filter((h) => h.hamlet === 'lower' && !['guests', 'water-guest'].includes(h.id));
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
  // Explicit canonical family; visitor arrangements never infer spouse/parent from ages.
  for (const [a, b, role] of [
    ['maryam', 'yusuf', 'child'],
    ['yusuf', 'maryam', 'parent'],
    ['yusuf-usta', 'meryem-visitor', 'grandchild'],
    ['meryem-visitor', 'yusuf-usta', 'grandparent'],
  ]) {
    const p = byId.get(a ?? '');
    if (p && b && role)
      seedTie(p, { otherId: b, roles: [role], affection: 0.7, familiarity: 0.95, trust: 0.75 });
  }
  for (const [a, b] of [
    ['maryam', 'danyal'],
    ['danyal', 'maryam'],
  ]) {
    const person = byId.get(a ?? '');
    if (person && b)
      seedTie(person, { otherId: b, roles: ['friend'], affection: 0.7, familiarity: 0.9, trust: 0.75 });
  }
  // Absent relatives are references, not simulated visitors or invented encounters.
  const samira = byId.get('samira');
  if (samira)
    seedTie(samira, { otherId: 'idris', roles: ['spouse'], affection: 0.8, familiarity: 0.95, trust: 0.75 });
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
