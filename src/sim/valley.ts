/**
 * The valley as an HF host: world truth (fields, stores, the agha's granary and due, weather), the HF `World` the
 * people decide in, and the day loop that lives them. Two modes, chosen per household at each midnight from sim
 * state only (never from frame timing, so a replay matches):
 *
 * - full: `stepCommunity`, minute-level decisions, for every household with an open ask, a visit in the last week,
 *   hunger, a birth near, a death, or a busy season (harvest and sowing);
 * - routine: `routineDay` (closed form, no decisions) for quiet households and small children, lived at the end of
 *   the day they cover.
 *
 * The kahya's asks are standing suggestions from the `kahya` voice, weighed at each of the person's own decisions
 * against their own day; the reply is that decision's resolution, captured at `beginOptions`.
 */
import {
  type Activity,
  type Affordance,
  addPerson,
  adoptVoiceTrust,
  ageYears,
  attraction,
  begin,
  birth,
  type Community,
  type CommunityState,
  canMarry,
  compatibility,
  conceive,
  conceptionChance,
  createCommunity,
  type DecisionRecord,
  decide,
  deliver,
  finish,
  glimpseOf,
  tick as hfTick,
  MUSLIM_CUSTOM,
  marry,
  type Outcome,
  type Percept,
  type Person,
  perceive,
  predictAs,
  pregnancyDue,
  promise,
  readBody,
  routineDay,
  type SimEvent,
  type Suggestion,
  type SuggestionResolution,
  spousesOf,
  stepCommunity,
  successChance,
  tellDeath,
  type World,
} from '@adam0white/human-framework';
import {
  DAY,
  dateWords,
  daylight,
  dayOfMinute,
  doyOf,
  HOUR,
  minuteOfDay,
  type Season,
  seasonOf,
  weatherOf,
  yearOf,
} from './calendar.ts';
import { foundValley, type Household, KAHYA, makeKahya } from './people.ts';
import { DRAW, hashUnit, mixSeed, strHash } from './rng.ts';
import {
  ASSENT,
  easeLaneWords,
  easeWords,
  giftWords,
  registerOf,
  seizeWords,
  speakerOf,
  type VoiceContext,
  visitWords,
} from './voices.ts';

// ---------- constants (engineering assumptions, tuned by the headless measure) ----------

export const V = {
  /** Kile a person eats in a day (about 200 kg of grain a year at 25 kg a kile). */
  ration: 0.03,
  /** Kile an adult reaps in an hour at skill 0.5 and full capacity. */
  reapRate: 0.9,
  /** Share of standing grain a storm flattens. */
  stormLoss: 0.3,
  /** Share of standing grain lost each day it stands after the harvest season ends. */
  overripeLoss: 0.04,
  /** The agha's own field, kile of a good year. */
  aghaField: 360,
  /** How hard a crier's call pulls (HF suggestion strength); tuned against the refusal band. */
  callStrength: Number(globalThis.process?.env?.CALL ?? 0.6),
  /** Seed per field, as a fraction of a full field's yield. */
  seed: 0.12,
  /** The granary at the start (the last kahya's carry-over). */
  granary: 30,
  /** Wage for called reapers: share of what they reap, paid to their house. */
  wageShare: 0.12,
  /** Hours of labour the mill needs. */
  millHours: 600,
  /** Kile a house of six needs to see the winter out without fear. */
  comfort: 0.6,
};

export type Job = 'reap-agha' | 'build-mill' | 'bring-share';
export type Verb = 'call' | 'take' | 'give' | 'visit' | 'insist' | 'seize' | 'ease' | 'attend' | 'borrow';

export interface Ask {
  id: string;
  job: Job;
  /** People asked. */
  personIds: string[];
  /** Households asked (for notes). */
  houses: string[];
  from: number;
  until: number;
  wage: boolean;
  /** People the kahya insisted with. */
  insisted: string[];
  /** Latest reply per person. */
  replies: Record<string, Reply>;
  /** Hours worked per person. */
  hours: Record<string, number>;
  closed?: boolean;
}

export interface Reply {
  at: number;
  verdict: SuggestionResolution['verdict'];
  kind?: SuggestionResolution['kind'];
  reason: string;
  says: string;
  chosen: string | null;
}

export type NoteKind =
  | 'story'
  | 'reply'
  | 'weather'
  | 'harvest'
  | 'due'
  | 'birth'
  | 'death'
  | 'wedding'
  | 'left'
  | 'knock'
  | 'visit'
  | 'theft'
  | 'letter'
  | 'gift'
  | 'seize'
  | 'prayer'
  | 'review'
  | 'work'
  | 'hunger'
  | 'voice';

export interface Note {
  id: number;
  at: number;
  kind: NoteKind;
  text: string;
  /** A person's own words, shown in the hand. */
  words?: string;
  who?: string;
  house?: string;
  /** How much it matters (ranks the day's top three; 3 slows the clock). */
  weight: number;
  /** The ask it answers. */
  ask?: string;
  /** A reply line rewritten the same day: the verdict it first said. */
  was?: string;
}

export interface Knock {
  id: string;
  at: number;
  personId: string;
  house: string;
  what: 'grain' | 'wedding' | 'birth' | 'death';
  words: string;
  answered?: 'gave' | 'refused' | 'went' | 'ignored';
  /** Minute it lapses. */
  until: number;
}

export interface Agha {
  standing: number;
  reaped: number;
  granary: number;
  /** Total due this year, kile. */
  due: number;
  /** Play day the rider comes for it. */
  dueDay: number;
  /** Kile handed to the rider so far, all years. */
  delivered: number;
  /** Years the due was short. */
  missed: number;
  /** Mill hours done (0 until the millwright comes in year two). */
  mill: number;
  millOpen: boolean;
  /** A small shortfall the rider wrote down against next year instead of reporting it. */
  arrears?: number;
  /** A loan written for from the agha: it comes up the valley later and is owed with interest at the next rider. */
  loan?: { kile: number; owe: number; asked: number; arrives: number; arrived?: boolean; paid?: boolean };
}

export interface KahyaState {
  place: string;
  /** A visit under way: house, arrival and leaving minutes. */
  visit?: { house: string; arrive: number; leave: number; back: number };
  /** Visit log: house to last minute visited. */
  seen: Record<string, number>;
  /** The kahya's read of each house's jars, as of the last visit (days of bread, world truth at that minute). */
  guess?: Record<string, { at: number; bread: number }>;
}

export interface Flags {
  /** The upper hamlet is under your seal (year two). */
  upper: boolean;
  /** Verbs revealed so far. */
  verbs: Verb[];
  /** Beats of the term already played. */
  beats: string[];
  ended?: 'term' | 'dismissed' | 'empty';
  /** What the elders said, fixed at the moment the term ended (recall changes memory, so it is read once). */
  gathering?: { elders: { id: string; name: string; house: string; words: string }[]; letter: string };
}

export interface ValleyState {
  v: 1;
  seed: number;
  minute: number;
  households: Household[];
  people: Person[];
  kahya: Person;
  /** People no longer in the valley (died, left), kept for names. */
  departed: Record<string, { name: string; house: string; day: number; why: 'left' | 'died' }>;
  agha: Agha;
  kahyaState: KahyaState;
  asks: Ask[];
  knocks: Knock[];
  notes: Note[];
  nextNote: number;
  community: CommunityState;
  /** People lived in full today (ids). */
  full: string[];
  flags: Flags;
  /** Per play day, sheaves missing from the agha's stooks (theft). */
  stolen: number;
  /** Percepts waiting for each person (gifts, seizures, visits). */
  queued: Record<string, Percept[]>;
  /** People who left or died this step, to be taken out of the lists. */
  leaving: string[];
  /** Day counters for the measure. */
  stats: {
    asks: number;
    verdicts: Record<string, number>;
    harvestVerdicts: Record<string, number>;
    /** The edges of the office over the term (absent in older saves): seizures, kile given, the hungry dead. */
    seized?: number;
    given?: number;
    starved?: { name: string; house: string; hard: boolean }[];
    /** Houses the kahya was hard with: seized from, or left waiting at the door with empty jars. */
    hard?: string[];
  };
  /** Lines said in the valley (key 'valley'), with the day, so a line is not said twice in a season. */
  said?: Record<string, Record<string, number>>;
  /** Who worked the agha's field today, for the evening tally (absent in older saves). */
  tally?: { day: number; who: string[] };
}

// ---------- founding ----------

export const START_MINUTE = 7 * HOUR;

export function newValley(seed: number): ValleyState {
  const { households, people } = foundValley(seed, 0);
  const kahya = makeKahya(seed, 0);
  const s: ValleyState = {
    v: 1,
    seed,
    minute: 0,
    households,
    people,
    kahya,
    departed: {},
    agha: {
      standing: V.aghaField,
      reaped: 0,
      granary: V.granary,
      due: 0,
      dueDay: 59,
      delivered: 0,
      missed: 0,
      mill: 0,
      millOpen: false,
    },
    kahyaState: { place: 'konak', seen: {} },
    asks: [],
    knocks: [],
    notes: [],
    nextNote: 1,
    community: stateOf(createCommunity([])),
    full: [],
    flags: { upper: false, verbs: ['call'], beats: [] },
    stolen: 0,
    queued: {},
    leaving: [],
    stats: { asks: 0, verdicts: {}, harvestVerdicts: {} },
  };
  s.agha.due = dueFor(s);
  // The reeve has lived among the lower lanes all his life: he has an impression of everyone there (clearest of kin).
  const osman = personOf(s, 'osman');
  if (osman) {
    for (const h of s.households) {
      if (h.hamlet !== 'lower') continue;
      for (const m of h.members) {
        const p = personOf(s, m);
        if (!p || p === osman) continue;
        for (let k = 0; k < 4; k++)
          glimpseOf(osman, p, -k * 30 * DAY, h.id === 'kavak' || h.id === 'ak' ? 0.9 : 0.6);
      }
    }
  }
  // The kahya has met the reeve once, at the agha's house in the city.
  if (osman) glimpseOf(s.kahya, osman, -60 * DAY, 0.5);
  ownFieldDuties(s, 0);
  chooseModes(s, 0);
  advanceTo(s, START_MINUTE);
  return s;
}

function stateOf(c: Community): CommunityState {
  const { people: _p, ...rest } = c;
  return structuredClone(rest) as CommunityState;
}

/** The agha's due for the year: his own field at a good year plus the houses' shares under your seal. */
export function dueFor(s: ValleyState): number {
  const shares = s.households
    .filter((h) => (s.flags.upper || h.hamlet === 'lower') && h.members.length > 0)
    .reduce((a, h) => a + h.share, 0);
  return Math.round(
    V.aghaField * 0.7 +
      shares +
      (s.agha.arrears ?? 0) +
      (s.agha.loan && !s.agha.loan.paid ? s.agha.loan.owe : 0) -
      (s.flags.beats.includes('mill-done') ? 40 : 0),
  );
}

// ---------- lookups ----------

export const personOf = (s: ValleyState, id: string) => s.people.find((p) => p.id === id);
export const houseOf = (s: ValleyState, id: string) => s.households.find((h) => h.id === id);
export const houseOfPerson = (s: ValleyState, pid: string) =>
  s.households.find((h) => h.members.includes(pid));
export const nameOf = (s: ValleyState, id: string) =>
  id === KAHYA ? 'you' : (personOf(s, id)?.name ?? s.departed[id]?.name ?? id);
export const isAdult = (p: Person) => ageYears(p) >= 15;
export const underSeal = (s: ValleyState, h: Household) => s.flags.upper || h.hamlet === 'lower';
const _seasonAt = (m: number): Season => seasonOf(doyOf(dayOfMinute(m)));

/** The house's grain per mouth, in days of eating. */
export function daysOfBread(_s: ValleyState, h: Household): number {
  const mouths = Math.max(1, h.members.length);
  return h.store / (mouths * V.ration);
}

/** Days until the next harvest is in (the store must last this long). */
function daysToHarvest(m: number): number {
  const doy = doyOf(dayOfMinute(m));
  return doy <= 200 ? 200 - doy : 365 - doy + 200;
}

/** How short of grain a house is, 0..1, for HF scarcity. */
export function scarcityOf(s: ValleyState, h: Household): number {
  const need = daysToHarvest(s.minute);
  const have = daysOfBread(s, h);
  return Math.max(0, Math.min(1, 1 - have / Math.max(30, need)));
}

// ---------- notes ----------

export function note(s: ValleyState, n: Omit<Note, 'id'>) {
  s.notes.push({ ...n, id: s.nextNote++ });
  if (s.notes.length > 400) s.notes.splice(0, s.notes.length - 400);
}

// ---------- the asks ----------

export function openAsksFor(s: ValleyState, pid: string, at: number): Ask[] {
  return s.asks.filter((a) => !a.closed && a.from <= at && a.until > at && a.personIds.includes(pid));
}

function suggestionFor(s: ValleyState, p: Person, at: number): Suggestion | undefined {
  const asks = openAsksFor(s, p.id, at);
  const a = asks[asks.length - 1];
  if (!a) return undefined;
  if (a.job === 'bring-share') {
    const h = houseOfPerson(s, p.id);
    if (!h || h.paid >= shareOwed(h) - 0.01) return undefined;
  }
  return {
    voiceId: KAHYA,
    action: a.job,
    strength: a.job === 'bring-share' ? 0.6 : V.callStrength,
    appeal: a.wage ? 'security' : 'duty',
    insist: a.insisted.includes(p.id),
    since: a.from,
  };
}

export const shareOwed = (h: Household) => (h.eased ? Math.round(h.share / 2) : h.share);

// ---------- the HF world ----------

function place(p: Person): string {
  return `house:${p.id}`;
}

/** Affordances a person has at `p.now`. */
export function offersFor(s: ValleyState, p: Person, at = p.now): Affordance[] {
  const h = houseOfPerson(s, p.id);
  const mod = minuteOfDay(at);
  const day = dayOfMinute(at);
  const doy = doyOf(day);
  const { rise, set } = daylight(doy);
  const light = mod >= rise && mod < set - 30;
  const season = seasonOf(doy);
  const sky = weatherOf(s.seed, day).sky;
  const home = h ? `house:${h.id}` : place(p);
  // Bed is for the dark, or for someone who can no longer keep their eyes open; a tired day-worker rests instead.
  const sleepy = !light || p.body.sleepPressure > 0.65 || p.body.sleepDebt > 0.5 || p.body.health < 0.5;
  const out: Affordance[] = [
    ...(sleepy
      ? [
          {
            id: 'sleep',
            action: 'sleep',
            label: 'sleep',
            placeId: home,
            duration: light ? 120 : Math.max(60, Math.min(480, ((rise + DAY - mod) % DAY) + 20)),
            effort: 0,
            mode: 'sleep' as const,
            advertises: { sleep: 0.8, rest: 0.4 },
            tags: ['sleep'],
          },
        ]
      : []),
    {
      id: 'rest',
      action: 'rest',
      label: 'rest at home',
      placeId: home,
      duration: 60,
      effort: 0,
      advertises: { rest: 0.3, leisure: 0.1, water: 0.2 },
      tags: ['rest', 'leisure'],
    },
    {
      id: 'drink',
      action: 'drink',
      label: 'drink at the spring',
      placeId: 'spring',
      duration: 10,
      effort: 0.05,
      advertises: { water: 0.6 },
    },
  ];
  if (!h) return out;
  const adult = isAdult(p);
  const lean = daysOfBread(s, h) < 20;
  if (h.store > 0.01) {
    out.push({
      id: 'eat',
      action: 'eat',
      label: lean ? 'eat a thin soup' : 'eat at home',
      placeId: home,
      duration: 30,
      effort: 0.05,
      advertises: { food: lean ? 0.3 : 0.6, water: 0.5 },
      tags: ['food'],
    });
  }
  if (!adult) return out;
  const weak = sky === 'storm' || sky === 'snow';
  if (light && !weak) {
    out.push({
      id: 'tend',
      action: 'tend',
      label: 'see to the house and animals',
      placeId: home,
      duration: 120,
      effort: 0.35,
      advertises: { competence: 0.04, safety: 0.03 },
      tags: ['work'],
    });
    // In the busy months the coffeehouse and the spring are for the noon break and the evening.
    const busyMonths = season === 'harvest' || season === 'threshing' || season === 'sowing';
    const breakTime = (mod >= 12 * HOUR && mod < 13 * HOUR) || mod >= set - 120;
    if (!busyMonths || breakTime)
      out.push({
        id: 'chat',
        action: 'chat',
        label: p.life.sex === 'male' ? 'sit at the coffeehouse' : 'talk at the spring',
        placeId: p.life.sex === 'male' ? 'coffeehouse' : 'spring',
        duration: 60,
        effort: 0.05,
        advertises: { belonging: 0.25, leisure: 0.15 },
        tags: ['social', 'leisure'],
      });
  }
  // Own field.
  if (light && !weak && (season === 'harvest' || season === 'threshing') && h.field.standing > 0.5) {
    out.push({
      id: 'reap',
      action: 'reap',
      label: 'reap our own barley',
      placeId: `field:${h.id}`,
      duration: 120,
      effort: 0.7,
      skill: { id: 'farming', difficulty: 0.3 },
      advertises: { safety: 0.12, competence: 0.05 },
      material: Math.min(4, h.field.standing * 0.1),
      tags: ['work', 'outdoors'],
    });
  }
  if (light && !weak && season === 'sowing' && h.field.sown < 1) {
    out.push({
      id: 'sow',
      action: 'sow',
      label: 'plough and sow our field',
      placeId: `field:${h.id}`,
      duration: 120,
      effort: 0.65,
      skill: { id: 'farming', difficulty: 0.35 },
      advertises: { safety: 0.1, competence: 0.05 },
      tags: ['work', 'outdoors'],
    });
  }
  // Asked work.
  const asks = openAsksFor(s, p.id, at);
  for (const a of asks) {
    if (a.job === 'reap-agha' && light && !weak && s.agha.standing > 0.5) {
      out.push({
        id: 'reap-agha',
        action: 'reap-agha',
        label: 'reap the agha’s barley',
        placeId: 'field:agha',
        duration: 120,
        effort: 0.7,
        skill: { id: 'farming', difficulty: 0.3 },
        advertises: { esteem: 0.03 },
        material: a.wage ? 1.2 : 0,
        tags: ['work', 'outdoors'],
      });
    }
    if (a.job === 'build-mill' && light && !weak && s.agha.mill < V.millHours) {
      out.push({
        id: 'build-mill',
        action: 'build-mill',
        label: 'carry stone for the mill',
        placeId: 'mill',
        duration: 120,
        effort: 0.8,
        advertises: { esteem: 0.04, meaning: 0.03 },
        material: a.wage ? 1 : 0,
        tags: ['work', 'outdoors'],
      });
    }
    // A house with nothing in the jar has nothing to carry down: no offer, so no yes that moves nothing.
    if (
      a.job === 'bring-share' &&
      light &&
      h.paid < shareOwed(h) - 0.01 &&
      h.members[0] === p.id &&
      h.store >= 1
    ) {
      const owe = shareOwed(h) - h.paid;
      out.push({
        id: 'bring-share',
        action: 'bring-share',
        label: `carry our share to the granary`,
        placeId: 'konak',
        duration: 40,
        effort: 0.3,
        advertises: { esteem: 0.05 },
        material: -owe * 0.35,
        norms: [{ normId: 'dues', relation: 'fulfills' }],
        tags: ['work'],
      });
      if (owe > 3) {
        out.push({
          id: 'bring-half',
          action: 'bring-share',
          label: 'carry half our share for now',
          placeId: 'konak',
          duration: 40,
          effort: 0.3,
          advertises: {},
          material: -owe * 0.15,
          tags: ['work'],
        });
      }
    }
  }
  // Quiet worship, for those who keep it.
  if (
    p.agenda.commitments.some(
      (c) => c.kind === 'worship' && c.status === 'pending' && c.from <= at && c.until > at,
    )
  ) {
    out.push({
      id: 'pray',
      action: 'pray',
      label: 'pray',
      placeId: p.life.sex === 'male' ? 'mosque' : home,
      duration: 15,
      effort: 0.05,
      advertises: { meaning: 0.1 },
      norms: [{ normId: 'salah', relation: 'fulfills' }],
      tags: ['worship'],
    });
  }
  // Hunger: the door of the konak, and the agha's stooks at night.
  if (daysOfBread(s, h) < 12 && h.members[0] === p.id && light && !knockedLately(s, h.id, p.now)) {
    out.push({
      id: 'ask-kahya',
      action: 'ask-kahya',
      label: 'go to the kahya’s door for grain',
      placeId: 'konak',
      duration: 50,
      effort: 0.2,
      advertises: { food: 0.2, esteem: -0.25, safety: 0.15 },
      tags: ['social'],
    });
  }
  if (daysOfBread(s, h) < 25 && s.agha.reaped > 2 && !light && mod > 21 * 60) {
    out.push({
      id: 'glean-agha',
      action: 'glean-agha',
      label: 'take a sheaf from the agha’s stooks',
      placeId: 'field:agha',
      duration: 40,
      effort: 0.3,
      advertises: { food: 0.25, safety: 0.1 },
      material: 1.5,
      norms: [{ normId: 'theft', relation: 'violates' }],
      tags: ['risky'],
      risk: { chance: 0.1, severity: 0.2, kind: 'caught' },
    });
  }
  // The city: for the young, when the house is hungry or the kahya has worn on them.
  const age = ageYears(p);
  const trust = p.will.voices.find((v) => v.voiceId === KAHYA)?.trust ?? 0.5;
  const unattached = spousesOf(p).length === 0 && h.members[0] !== p.id && !p.family?.pregnancy;
  if (
    age >= 17 &&
    age <= 32 &&
    unattached &&
    light &&
    s.minute > 60 * DAY &&
    (prospectDays(s, h) < 20 || trust < 0.15)
  ) {
    out.push({
      id: 'leave',
      action: 'leave',
      label: 'leave for the city',
      placeId: 'road',
      duration: 240,
      effort: 0.4,
      advertises: { safety: 0.2, autonomy: 0.3, esteem: 0.1, belonging: -0.5 },
      material: 5,
      tags: ['novel', 'risky'],
    });
  }
  return out;
}

function capacityOf(p: Person): number {
  return readBody(p).capacity;
}

/** Kile reaped by `p` over `hours`. */
/** Plough and sow part of a field; seed (an eighth of a full field's yield) comes out of the house's store. */
function sowField(h: Household, d: number) {
  const want = Math.min(d, 1 - h.field.sown);
  if (want <= 0) return;
  const seedPer = h.field.size * V.seed;
  const can = Math.min(want, h.store / Math.max(0.01, seedPer));
  h.store -= can * seedPer;
  h.field.sown += can;
}

/** The day the rider comes next (this year's, or an estimate of next year's once this year's has passed). */
export function nextRiderDay(s: ValleyState): number {
  let d = s.agha.dueDay;
  while (d * DAY + 11 * HOUR < s.minute) d += 365;
  return d;
}

/** Days of bread counting what still stands or lies in the field. */
export function prospectDays(_s: ValleyState, h: Household): number {
  const mouths = Math.max(1, h.members.length);
  return (h.store + h.field.standing + h.field.reaped) / (mouths * V.ration);
}

/** A house that came to the door in the last six days (or is still waiting) does not come again yet. */
function knockedLately(s: ValleyState, house: string, now: number): boolean {
  return s.knocks.some(
    (k) => k.house === house && k.what === 'grain' && (!k.answered || k.at > now - 6 * DAY),
  );
}

function reapAmount(_s: ValleyState, p: Person, hours: number, protest: boolean): number {
  const skill = p.skills.farming?.level ?? 0.5;
  const ok = successChance(p, 'farming', 0.3, capacityOf(p));
  return V.reapRate * hours * (0.6 + 0.8 * skill) * (0.5 + 0.5 * ok) * (protest ? 0.6 : 1);
}

export function makeWorld(s: ValleyState): World {
  return {
    now: () => s.minute,
    affordancesFor: (p) => offersFor(s, p),
    perceptsFor: (p, since, until) => {
      const q = s.queued[p.id];
      if (!q || q.length === 0) return [];
      const out = q.filter((x) => x.at <= until).map((x) => ({ ...x, at: Math.max(x.at, since + 1) }));
      s.queued[p.id] = q.filter((x) => x.at > until);
      return out;
    },
    scarcityFor: (p) => {
      const h = houseOfPerson(s, p.id);
      return h ? scarcityOf(s, h) : 0;
    },
    beginOptions: (p, offer, record) => {
      captureReply(s, p, offer, record);
      return undefined;
    },
    resolve: (p, act, reason) => resolveActivity(s, p, act, reason),
  };
}

function captureReply(s: ValleyState, p: Person, offer: Affordance, record: DecisionRecord) {
  const res =
    record.suggestion?.voiceId === KAHYA
      ? record.suggestion
      : record.suggestions?.find((r) => r.voiceId === KAHYA);
  if (!res) return;
  const ask = openAsksFor(s, p.id, p.now).at(-1);
  if (!ask) return;
  const prev = ask.replies[p.id];
  const reply: Reply = {
    at: p.now,
    verdict: res.verdict,
    reason: res.reason,
    says: res.says,
    chosen: offer.action,
  };
  if (res.kind) reply.kind = res.kind;
  // Only what a person does with the day is an answer. A drink at the spring first is not.
  const substantive =
    DAY_ACTIONS.has(offer.action) ||
    res.verdict === 'refused' ||
    res.verdict === 'complied' ||
    res.verdict === 'modified' ||
    /^(commitment|distrust|capacity|material|norm)/.test(res.reason);
  const worship = res.commitmentId
    ? p.agenda.commitments.find((c) => c.id === res.commitmentId)?.kind === 'worship'
    : false;
  if (!substantive || worship || offer.action === 'pray') return;
  // Asleep is not an answer; they answer when they wake.
  if (res.verdict === 'refused' && /sleep/i.test(`${res.reason} ${res.says ?? ''}`)) return;
  // Going to bed, resting, eating or drinking is not an answer either, whatever the verdict says.
  if (!DAY_ACTIONS.has(offer.action) && BODY_ACTIONS.has(offer.action)) return;
  ask.replies[p.id] = reply;
  const sameDay = prev && dayOfMinute(prev.at) === dayOfMinute(reply.at);
  const changed = !prev || prev.verdict !== reply.verdict || prev.chosen !== reply.chosen;
  if (!changed || (sameDay && reply.verdict === prev?.verdict)) return;
  s.stats.asks++;
  s.stats.verdicts[res.verdict] = (s.stats.verdicts[res.verdict] ?? 0) + 1;
  if (ask.job === 'reap-agha')
    s.stats.harvestVerdicts[res.verdict] = (s.stats.harvestVerdicts[res.verdict] ?? 0) + 1;
  const h = houseOfPerson(s, p.id);
  const words = replyWords(s, p, ask, reply);
  // An answer is also a look at the person: the kahya's hunch about them moves a little.
  glimpseOf(s.kahya, p, Math.max(reply.at, s.kahya.now), 0.5);
  // One line per person per ask per day: a change of mind the same day rewrites that line.
  const today = dayOfMinute(reply.at);
  const mine = sameDay
    ? s.notes.findLast(
        (n) => n.kind === 'reply' && n.ask === ask.id && n.who === p.id && dayOfMinute(n.at) === today,
      )
    : undefined;
  if (mine) {
    const first = (mine.was ?? prev?.verdict ?? reply.verdict) as Reply['verdict'];
    mine.was = first;
    mine.text =
      first === reply.verdict
        ? replyText(s, p, ask, reply)
        : `${p.name} ${PAST[first]?.(ask.job) ?? 'answered'}, then ${PAST[reply.verdict]?.(ask.job) ?? 'answered'}.`;
    mine.words = words;
    mine.weight = Math.max(mine.weight, reply.verdict === 'refused' ? 3 : 2);
    return;
  }
  const weight =
    reply.verdict === 'assented'
      ? prev
        ? 0.5
        : 1
      : reply.verdict === 'refused'
        ? 3
        : reply.verdict === 'complied'
          ? 2.5
          : 2;
  note(s, {
    at: p.now,
    kind: 'reply',
    text: replyText(s, p, ask, reply),
    words,
    who: p.id,
    ...(h ? { house: h.id } : {}),
    weight,
    ask: ask.id,
  });
}

/** Actions that are what someone does with their day (an answer to an ask), not a pause before it. */
const BODY_ACTIONS = new Set(['sleep', 'rest', 'drink', 'eat']);
const DAY_ACTIONS = new Set([
  'reap',
  'reap-agha',
  'build-mill',
  'bring-share',
  'sow',
  'tend',
  'chat',
  'leave',
  'ask-kahya',
]);

/** A verdict as a past-tense clause, for a line that says someone changed their mind. */
const PAST: Record<string, (job: Job) => string> = {
  assented: (job) => (job === 'bring-share' ? 'carried the share down' : 'came'),
  complied: () => 'came because you pressed',
  deferred: (job) => `put ${JOB_WORDS[job]} off`,
  modified: (job) => (job === 'bring-share' ? 'brought half' : 'did something else'),
  refused: () => 'would not',
};

const JOB_WORDS: Record<Job, string> = {
  'reap-agha': 'the agha’s barley',
  'build-mill': 'the mill',
  'bring-share': 'the share',
};

function replyText(_s: ValleyState, p: Person, ask: Ask, r: Reply): string {
  const job = JOB_WORDS[ask.job];
  switch (r.verdict) {
    case 'assented':
      return ask.job === 'bring-share' ? `${p.name} carried the share down.` : `${p.name} came to ${job}.`;
    case 'complied':
      return `${p.name} came to ${job}, slowly, because you pressed.`;
    case 'deferred':
      return `${p.name} put ${job} off.`;
    case 'modified':
      return ask.job === 'bring-share' ? `${p.name} brought half.` : `${p.name} did something else instead.`;
    case 'refused':
      return `${p.name} would not.`;
    default:
      return `${p.name} answered.`;
  }
}

/** The person's words, with HF's line kept only where it reads right (The Pass: never a generic line where it is wrong). */
function replyWords(s: ValleyState, p: Person, ask: Ask, r: Reply): string {
  const h = houseOfPerson(s, p.id);
  // Two people of the valley do not say the same words on the same day: the pick moves on to an unsaid line.
  s.said ??= {};
  const today = s.said.today ?? {};
  const day = dayOfMinute(r.at);
  const pick = (xs: string[]) => {
    const start = Math.floor(hashUnit(s.seed, DRAW.line, strHash(p.id), r.at) * xs.length);
    for (let i = 0; i < xs.length; i++) {
      const line = xs[(start + i) % xs.length] ?? '';
      if (today[line] !== day) {
        today[line] = day;
        s.said ??= {};
        s.said.today = today;
        return line;
      }
    }
    return xs[start] ?? xs[0] ?? '';
  };
  if (r.verdict === 'assented') {
    const a = ASSENT[registerOf(p)];
    if (ask.wage && ask.job !== 'bring-share') return pick(a.paid);
    if (ask.job === 'reap-agha') return pick(a.reap);
    if (ask.job === 'bring-share') return pick(a.share);
    return pick(a.carry);
  }
  if (r.verdict === 'complied')
    return pick(['Since you insist.', 'I’m coming. Don’t stand over me.', 'As you say, kahya.']);
  if (r.verdict === 'modified') {
    if (ask.job === 'bring-share')
      return pick(['Half now. The rest when I can.', 'Take half. We have mouths.']);
    return r.says;
  }
  if (r.reason.startsWith('commitment:')) {
    const cid = r.reason.slice('commitment:'.length);
    const c = p.agenda.commitments.find((x) => x.id === cid);
    if (c?.label === 'our own barley')
      return pick([
        'Our own barley first. Then the agha’s.',
        'After our own field. It’s ripe too.',
        'My barley will rot, kahya. After.',
      ]);
    if (c?.label) return `${c.label[0]?.toUpperCase() ?? ''}${c.label.slice(1)}. After.`;
  }
  if (r.reason.startsWith('material') || r.reason === 'need:safety') {
    if (ask.job === 'bring-share')
      return pick([
        'Not yet. Winter is long.',
        'We’ve barely enough, kahya.',
        'Give me till the threshing is done.',
      ]);
    return pick(['Our own barley first. Then the agha’s.', 'Who feeds mine while I cut his?']);
  }
  if (r.reason === 'distrust')
    return pick(['The last kahya said that too.', 'I remember what your office took.', 'No. Not for you.']);
  if (r.reason.startsWith('capacity'))
    return pick(['I can’t. My back’s gone.', 'I’ve nothing left in me today.']);
  if (r.reason.startsWith('need:food')) return pick(['On an empty stomach? Let me eat.', 'I haven’t eaten.']);
  if (r.reason.startsWith('need:sleep') || r.reason.startsWith('need:rest'))
    return pick(['I’m dead on my feet.', 'Let me rest first.']);
  if (h && daysOfBread(s, h) < 20) return 'There’s no bread in the house, kahya.';
  return r.says;
}

function resolveActivity(s: ValleyState, p: Person, act: Activity, reason: 'ended' | 'interrupted'): Outcome {
  const now = p.now;
  const base: Outcome = { affordanceId: act.affordanceId, action: act.action, status: 'completed', at: now };
  if (act.targetId !== undefined) base.targetId = act.targetId;
  const span = Math.max(1, act.endsAt - act.startedAt);
  const progress = reason === 'interrupted' ? Math.max(0, Math.min(1, (now - act.startedAt) / span)) : 1;
  const hours = (span * progress) / 60;
  const h = houseOfPerson(s, p.id);
  if (reason === 'interrupted') base.status = 'interrupted';
  switch (act.action) {
    case 'reap': {
      if (!h) break;
      const amt = Math.min(h.field.standing, reapAmount(s, p, hours, !!act.protest));
      h.field.standing -= amt;
      h.field.reaped += amt;
      return {
        ...base,
        needs: { competence: 0.05 * progress, safety: 0.05 * progress },
        material: amt * 0.2,
      };
    }
    case 'sow': {
      if (!h) break;
      sowField(h, hours * 0.025 * (0.6 + 0.8 * (p.skills.farming?.level ?? 0.5)));
      return { ...base, needs: { competence: 0.05 * progress, safety: 0.05 * progress } };
    }
    case 'reap-agha': {
      const amt = Math.min(s.agha.standing, reapAmount(s, p, hours, !!act.protest));
      s.agha.standing -= amt;
      s.agha.reaped += amt;
      if (amt > 0) {
        const d = dayOfMinute(act.startedAt);
        if (s.tally?.day !== d) s.tally = { day: d, who: [] };
        if (!s.tally.who.includes(p.id)) s.tally.who.push(p.id);
      }
      const ask = openAsksFor(s, p.id, act.startedAt).find((a) => a.job === 'reap-agha');
      let material = 0;
      if (ask) {
        ask.hours[p.id] = (ask.hours[p.id] ?? 0) + hours;
        if (ask.wage && h) {
          const wage = amt * V.wageShare;
          s.agha.reaped -= wage;
          h.store += wage;
          material = wage;
        }
      }
      const out: Outcome = { ...base, material };
      if (act.protest) out.quality = 0.5;
      return out;
    }
    case 'build-mill': {
      s.agha.mill = Math.min(V.millHours, s.agha.mill + hours * (act.protest ? 0.6 : 1));
      const ask = openAsksFor(s, p.id, act.startedAt).find((a) => a.job === 'build-mill');
      if (ask) ask.hours[p.id] = (ask.hours[p.id] ?? 0) + hours;
      return { ...base, needs: { competence: 0.03 } };
    }
    case 'bring-share': {
      if (!h || reason === 'interrupted') return { ...base, status: 'interrupted' };
      const owe = Math.max(0, shareOwed(h) - h.paid);
      const amt = Math.min(h.store, act.affordanceId === 'bring-half' ? owe / 2 : owe);
      h.store -= amt;
      h.paid += amt;
      s.agha.granary += amt;
      return { ...base, material: -amt };
    }
    case 'eat': {
      return {
        ...base,
        needs: { food: (h && daysOfBread(s, h) < 20 ? 0.3 : 0.6) * progress, water: 0.5 * progress },
      };
    }
    case 'drink':
      return { ...base, needs: { water: 0.6 } };
    case 'chat':
      return { ...base, needs: { belonging: 0.2 * progress, leisure: 0.1 * progress } };
    case 'pray':
      if (
        dayOfMinute(now) % 9 === 0 &&
        hashUnit(s.seed, DRAW.line, strHash(p.id), dayOfMinute(now)) < 0.08 &&
        p.life.sex === 'male'
      ) {
        note(s, {
          at: now,
          kind: 'prayer',
          text: `At dusk ${p.name} went down to the mosque, as he does.`,
          who: p.id,
          ...(h ? { house: h.id } : {}),
          weight: 0.2,
        });
      }
      return { ...base, needs: { meaning: 0.1 } };
    case 'ask-kahya': {
      if (reason === 'interrupted' || !h) break;
      if (!knockedLately(s, h.id, now)) {
        const words = [
          'Kahya, there is nothing in the jar. The children…',
          'I wouldn’t come if I had a choice.',
          'Lend it to us. We will pay at the threshing.',
        ];
        const k: Knock = {
          id: `k${s.nextNote}`,
          at: now,
          personId: p.id,
          house: h.id,
          what: 'grain',
          words: words[Math.floor(hashUnit(s.seed, DRAW.line, strHash(p.id), now) * words.length)] ?? '',
          until: now + 2 * DAY,
        };
        s.knocks.push(k);
        note(s, {
          at: now,
          kind: 'knock',
          text: `${p.name} of ${h.name} came to your door.`,
          words: k.words,
          who: p.id,
          house: h.id,
          weight: 3,
        });
      }
      return { ...base, needs: { food: 0 } };
    }
    case 'glean-agha': {
      if (reason === 'interrupted' || !h) break;
      const amt = Math.min(1.5, s.agha.reaped);
      s.agha.reaped -= amt;
      h.store += amt;
      s.stolen += amt;
      return { ...base, needs: { food: 0.1 }, material: amt };
    }
    case 'leave': {
      if (reason === 'interrupted' || !h) break;
      depart(s, p, h, 'left');
      return base;
    }
    default:
      break;
  }
  return base;
}

function depart(s: ValleyState, p: Person, h: Household, why: 'left' | 'died') {
  h.members = h.members.filter((m) => m !== p.id);
  h.gone.push({ id: p.id, day: dayOfMinute(s.minute), why });
  s.departed[p.id] = { name: p.name, house: h.id, day: dayOfMinute(s.minute), why };
  s.leaving.push(p.id);
  if (why === 'left') {
    const lines = [
      'Tell my mother I’ll write.',
      'There is work in the city. There is nothing here.',
      'Don’t look for me at the threshing.',
    ];
    const words = lines[Math.floor(hashUnit(s.seed, DRAW.line, strHash(p.id), 3) * lines.length)] ?? '';
    note(s, {
      at: s.minute,
      kind: 'left',
      text: `${p.name} of ${h.name} left for the city at first light.`,
      words,
      who: p.id,
      house: h.id,
      weight: 3,
    });
  }
}

// ---------- queued percepts ----------

export function queuePercept(s: ValleyState, pid: string, pc: Percept) {
  const list = s.queued[pid] ?? [];
  list.push(pc);
  s.queued[pid] = list;
}

// ---------- the day loop ----------

let world: World | null = null;
let worldFor: ValleyState | null = null;
let community: Community | null = null;
let communityFor: ValleyState | null = null;

function worldOf(s: ValleyState): World {
  if (worldFor !== s || !world) {
    world = makeWorld(s);
    worldFor = s;
  }
  return world;
}

function communityOf(s: ValleyState): Community {
  if (communityFor !== s || !community) {
    // Another valley was live in this module: write its community back before taking this one up.
    if (community && communityFor && communityFor !== s) communityFor.community = stateOf(community);
    const people = s.full.map((id) => personOf(s, id)).filter((p): p is Person => !!p);
    community = createCommunity(people, s.community);
    communityFor = s;
  }
  return community;
}

/** Write the community's host state into the valley (before a save). */
export function syncCommunity(s: ValleyState) {
  s.community = stateOf(communityOf(s));
}

/** Drop the cached community (after a restore). */
export function resetCaches() {
  world = null;
  worldFor = null;
  community = null;
  communityFor = null;
}

/** Bring a person into full mode now (an ask or a visit reached them). Deterministic: called only from inputs. */
export function promote(s: ValleyState, pid: string) {
  if (s.full.includes(pid)) return;
  const p = personOf(s, pid);
  if (!p?.body.alive) return;
  s.full.push(pid);
  s.full.sort();
  const c = communityOf(s);
  addPerson(c, p);
}

/** Who lives in full on day `day`: chosen at its midnight from sim state. */
function chooseModes(s: ValleyState, day: number) {
  const season = seasonOf(doyOf(day));
  const busy = season === 'harvest';
  const at = day * DAY;
  const ids: string[] = [];
  for (const h of s.households) {
    const asked = s.asks.some((a) => !a.closed && a.until > at && a.houses.includes(h.id));
    const visited = (s.kahyaState.seen[h.id] ?? -1e9) > at - 7 * DAY;
    const hungry = daysOfBread(s, h) < 40;
    const birthNear = h.members.some((m) => {
      const p = personOf(s, m);
      const due = p?.family?.pregnancy?.dueAt;
      return due !== undefined && due < at + 5 * DAY;
    });
    const lived = (busy && underSeal(s, h)) || asked || visited || hungry || birthNear;
    if (!lived) continue;
    for (const m of h.members) {
      const p = personOf(s, m);
      if (p?.body.alive && ageYears(p) >= 12) ids.push(m);
    }
  }
  ids.sort();
  if (communityFor === s && community) s.community = stateOf(community);
  s.full = ids;
  communityFor = null;
  // Carry host state across the rebuild.
  const c = createCommunity(
    ids.map((id) => personOf(s, id)).filter((p): p is Person => !!p),
    s.community,
  );
  community = c;
  communityFor = s;
}

/** Live the valley to minute `to`. */
export function advanceTo(s: ValleyState, to: number): SimEvent[] {
  const events: SimEvent[] = [];
  while (s.minute < to) {
    const day = dayOfMinute(s.minute);
    const midnight = (day + 1) * DAY;
    const stepTo = Math.min(to, midnight);
    const c = communityOf(s);
    const suggestions: Record<string, Suggestion> = {};
    for (const p of c.people) {
      const sg = suggestionFor(s, p, stepTo);
      if (sg) suggestions[p.id] = sg;
    }
    const ev = stepCommunity(c, worldOf(s), stepTo, {
      suggestions,
      lifecourse: { mortality: true },
      maxEvents: 4000,
      contagion: false,
    });
    for (const e of ev) if (e.kind === 'died' || e.kind === 'finish') events.push(e);
    kahyaTo(s, stepTo);
    s.minute = stepTo;
    afterStep(s, ev);
    if (stepTo === midnight) endOfDay(s, day);
  }
  return events;
}

/** The kahya lives only his walks: time passes, and a walk is a real HF activity so his legs tire. */
function kahyaTo(s: ValleyState, to: number) {
  const k = s.kahya;
  const v = s.kahyaState.visit;
  const act = k.activity;
  if (act && v && v.back <= to) {
    hfTick(k, Math.max(k.now, v.back));
    finish(k, { affordanceId: act.affordanceId, action: act.action, status: 'completed', at: k.now });
  }
  if (k.now < to && !(k.activity && k.activity.endsAt > to)) hfTick(k, to);
  else if (k.now < to) hfTick(k, to);
}

function afterStep(s: ValleyState, ev: SimEvent[]) {
  for (const e of ev) {
    if (e.kind === 'died') {
      const p = personOf(s, e.personId);
      const h = houseOfPerson(s, e.personId);
      if (p && h) dies(s, p, h, e.at);
    }
  }
  if (s.leaving.length) {
    const gone = new Set(s.leaving);
    s.people = s.people.filter((p) => !gone.has(p.id));
    s.full = s.full.filter((id) => !gone.has(id));
    const c = communityOf(s);
    c.people = c.people.filter((p) => !gone.has(p.id));
    s.leaving = [];
  }
}

/** The kahya was hard with this house: it is remembered at the end of the term. */
function markHard(s: ValleyState, hid: string) {
  s.stats.hard ??= [];
  if (!s.stats.hard.includes(hid)) s.stats.hard.push(hid);
}

function dies(s: ValleyState, p: Person, h: Household, at: number) {
  const all = createCommunity(s.people.filter((q) => q.now <= at || q === p));
  try {
    tellDeath(all, p, at);
  } catch {
    // Someone's clock ran past the news; they hear it at their next look (engineering fallback).
  }
  const age = Math.floor(ageYears(p));
  const hungry = daysOfBread(s, h) < 2;
  if (hungry && underSeal(s, h)) {
    s.stats.starved ??= [];
    s.stats.starved.push({ name: p.name, house: h.id, hard: (s.stats.hard ?? []).includes(h.id) });
  }
  note(s, {
    at,
    kind: 'death',
    text: `${p.name} of ${h.name} died${age >= 60 ? ', old' : age < 5 ? ', a small child' : ''}${hungry ? ', after weeks with nothing in the jar' : ''}. They buried ${p.life.sex === 'female' ? 'her' : 'him'} before the evening prayer.`,
    who: p.id,
    house: h.id,
    weight: 3,
  });
  s.knocks.push({
    id: `k${s.nextNote}`,
    at,
    personId: h.members.find((m) => m !== p.id) ?? p.id,
    house: h.id,
    what: 'death',
    words: 'They will sit with the family three days.',
    until: at + 3 * DAY,
  });
  depart(s, p, h, 'died');
}

function shareAmongNeighbours(s: ValleyState, day: number) {
  const at = (day + 1) * DAY - 3 * HOUR;
  for (const hungry of s.households) {
    if (!hungry.members.length || daysOfBread(s, hungry) >= 10) continue;
    const givers = s.households
      .filter(
        (h) => h !== hungry && h.hamlet === hungry.hamlet && h.members.length && daysOfBread(s, h) > 150,
      )
      .sort((a, b) => daysOfBread(s, b) - daysOfBread(s, a));
    for (const g of givers) {
      const head = personOf(s, g.members[0] ?? '');
      if (!head) continue;
      const kind = 0.25 + 0.6 * head.traits.agreeableness;
      if (hashUnit(s.seed, DRAW.household, strHash(g.id + hungry.id), day) > kind) continue;
      const amt = Math.min(g.store * 0.1, hungry.members.length * V.ration * 21);
      g.store -= amt;
      hungry.store += amt;
      note(s, {
        at,
        kind: 'story',
        text: `${g.name} carried barley to ${hungry.name} after dark. Nobody said anything about it.`,
        house: hungry.id,
        weight: 1.5,
      });
      break;
    }
  }
}

function endOfDay(s: ValleyState, day: number) {
  const at = (day + 1) * DAY;
  // Routine lives for everyone not lived in full today, for the day just passed.
  const full = new Set(s.full);
  for (const p of s.people) {
    if (full.has(p.id) || !p.body.alive) continue;
    if (p.now >= at) continue;
    const h = houseOfPerson(s, p.id);
    const rd = routineDay(p, routineFor(s, p, day), { lifecourse: { mortality: true } });
    if (rd.died && h) dies(s, p, h, rd.at);
  }
  afterStep(s, []);
  // Houses nobody lived in full today worked their own field at a plain pace.
  const season = seasonOf(doyOf(day));
  for (const h of s.households) {
    if (h.members.some((m) => full.has(m))) continue;
    const adults = h.members
      .map((m) => personOf(s, m))
      .filter((p): p is Person => !!p && p.body.alive && isAdult(p)).length;
    if (!adults) continue;
    if ((season === 'harvest' || season === 'threshing') && h.field.standing > 0) {
      const amt = Math.min(h.field.standing, adults * 6 * V.reapRate);
      h.field.standing -= amt;
      h.field.reaped += amt;
    }
    if (season === 'sowing') sowField(h, adults * 0.12);
  }
  // Neighbours: once a week a hungry house is fed a little by a house of its hamlet that has plenty, if that
  // house's head is the giving kind. A world rule, not an HF act (engineering assumption, see docs/hf-requests.md).
  if (day % 7 === 3) shareAmongNeighbours(s, day);
  // A loan from the agha arrives with his man.
  if (s.agha.loan && !s.agha.loan.arrived && s.agha.loan.arrives <= (day + 1) * DAY) {
    s.agha.loan.arrived = true;
    s.agha.granary += s.agha.loan.kile;
    note(s, {
      at: s.agha.loan.arrives,
      kind: 'letter',
      text: `The agha’s man came up with ${s.agha.loan.kile} kile on two mules. The letter says it will be ${s.agha.loan.owe} at the next rider.`,
      weight: 3,
    });
  }
  eveningTally(s, day);
  laneLife(s, day);
  hungerWord(s, day);
  lapseKnocks(s, (day + 1) * DAY);
  s.knocks = s.knocks.filter((k) => !k.answered || k.until > (day - 30) * DAY);
  granaryMilestones(s, day);
  // Eating: every house eats from its store.
  for (const h of s.households) {
    h.store = Math.max(0, h.store - h.members.length * V.ration);
  }
  const next = day + 1;
  const doy = doyOf(next);
  const wx = weatherOf(s.seed, next);
  // Weather on the fields.
  if (wx.sky === 'storm') {
    const lost = s.agha.standing * V.stormLoss;
    s.agha.standing -= lost;
    let houses = 0;
    for (const h of s.households) {
      if (h.field.standing > 1) houses++;
      h.field.standing *= 1 - V.stormLoss;
    }
    if (lost > 1 || houses > 0) {
      note(s, {
        at: next * DAY + 5 * 60,
        kind: 'weather',
        text:
          lost > 1
            ? `The storm came over the ridge in the night. It flattened about ${Math.round(lost)} kile of the agha’s standing barley${houses ? `, and laid down ${houses} of the houses’ fields` : ''}.`
            : 'The storm came over the ridge in the night and laid the standing barley down.',
        weight: 3,
      });
    }
  }
  if (seasonOf(doy) !== 'harvest' && seasonOf(doy) !== 'threshing') {
    s.agha.standing *= 1 - V.overripeLoss;
    for (const h of s.households) h.field.standing *= 1 - V.overripeLoss;
  }
  // The threshing floor: from the 5th of Ağustos, reaped sheaves come in as grain.
  if (doy >= 216 && doy < 262) {
    for (const h of s.households) {
      const t = Math.min(h.field.reaped, Math.max(3, h.field.size * 0.06));
      h.field.reaped -= t;
      h.store += t;
    }
    const t = Math.min(s.agha.reaped, 12);
    s.agha.reaped -= t;
    s.agha.granary += t;
  }
  if (doy === 216) {
    note(s, {
      at: next * DAY + 6 * 60,
      kind: 'harvest',
      text: 'The threshing floors opened. Oxen went round and round all day, and the chaff blew down the valley.',
      weight: 2,
    });
  }
  // Sowing season closes the fields.
  if (doy === 318) {
    for (const h of s.households) {
      h.field.standing = 0;
      h.field.reaped = 0;
    }
  }
  // A new crop stands in the summer from what was sown.
  if (doy === 175) {
    for (const h of s.households) {
      const yieldU = 0.7 + 0.5 * hashUnit(s.seed, DRAW.yield, strHash(h.id), yearOf(next));
      h.field.standing = h.field.size * Math.max(0.2, h.field.sown) * yieldU;
      h.field.sown = 0;
      h.paid = 0;
      h.eased = false;
    }
    s.agha.standing = V.aghaField * (0.6 + 0.5 * hashUnit(s.seed, DRAW.yield, 999, yearOf(next)));
    s.agha.due = dueFor(s);
    s.agha.dueDay = next + (259 - doy);
    const owed = (s.agha.arrears ?? 0) + (s.agha.loan && !s.agha.loan.paid ? s.agha.loan.owe : 0);
    note(s, {
      at: next * DAY + 8 * 60,
      kind: 'letter',
      text: `The agha’s letter for the year: his due is ${s.agha.due} kile by ${dateWords(s.agha.dueDay)}. His own field, every house’s share${owed ? `, and ${owed} still owed to him from before` : ''}${s.flags.beats.includes('mill-done') ? ', less forty for the mill' : ''}.`,
      weight: 2.5,
    });
  }
  // Births.
  for (const p of [...s.people]) {
    if (!p.body.alive || !p.family?.pregnancy) continue;
    if (p.family.pregnancy.dueAt > at + DAY) continue;
    const h = houseOfPerson(s, p.id);
    const father = personOf(s, p.family.pregnancy.fatherId);
    if (!h || !father) {
      if (p.family.pregnancy.dueAt < at - 30 * DAY) delete p.family.pregnancy;
      continue;
    }
    if (!pregnancyDue(p, Math.max(p.now, p.family.pregnancy.dueAt))) continue;
    born(s, p, father, h, Math.max(p.now, p.family.pregnancy.dueAt, at - DAY + 4 * 60));
  }
  // Conception: married couples, a draw each new moon (every 29 days).
  if (next % 29 === 0) {
    for (const h of s.households) {
      for (const m of h.members) {
        const w = personOf(s, m);
        if (w?.life.sex !== 'female' || w.family?.pregnancy) continue;
        const sp = spousesOf(w)[0];
        const husband = sp ? personOf(s, sp) : undefined;
        if (!husband) continue;
        const pc = conceptionChance(w, husband, 29);
        if (hashUnit(s.seed, DRAW.conceive, strHash(w.id), next) < pc * 0.7) {
          conceive(w, husband, mixSeed(s.seed, strHash(w.id), next), Math.max(w.now, husband.now));
        }
      }
    }
  }
  // Weddings: after the threshing, the young of different houses.
  if (doy === 268 || doy === 290) weddings(s, next);
  // The agha's rider.
  if (next === s.agha.dueDay) riderComes(s, next);
  ownFieldDuties(s, next);
  chooseModes(s, next);
}

/**
 * Each harvest dawn, every grown member of a house with barley standing holds "our own barley" for the day: a job
 * owed to the house, heavier the more stands and the nearer the rain. This is what a call competes with.
 */
const COUNT = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
];

/** The evening word from the agha's field: who came, and roughly how much is cut. Approximate on purpose. */
function eveningTally(s: ValleyState, day: number) {
  const t = s.tally;
  if (!t || t.day !== day || !t.who.length) return;
  delete s.tally;
  const n = t.who.length;
  const who = n <= 12 ? `${COUNT[n]} ${n === 1 ? 'person' : 'people'}` : 'More than a dozen';
  const left = s.agha.standing;
  const cutKey = `cut-${yearOf(day)}`;
  if (s.flags.beats.includes(cutKey)) return;
  if (left < 3) s.flags.beats.push(cutKey);
  const cut =
    left < 3
      ? 'The last of it is cut.'
      : left < 0.25 * V.aghaField
        ? 'Most of it is cut now.'
        : left < 0.6 * V.aghaField
          ? 'About half of it stands.'
          : 'Most of it still stands.';
  note(s, {
    at: day * DAY + 19 * 60,
    kind: 'work',
    text: `${who} worked the agha’s field today. ${cut}`,
    weight: left < 3 ? 2.5 : 1.5,
  });
}

/** The lanes when nothing is asked of them: in winter, and on quiet stretches, someone's evening, every few days. */
const LANE: Record<string, string[]> = {
  winter: [
    '{who} of {house} has the loom up by the stove. You can hear it from the lane.',
    'Snow on the upper lanes. The {fam} children were out on a tray until dark.',
    'The men sat late over backgammon at the coffeehouse. {who} lost, and blamed the dice.',
    '{who} of {house} mended a yoke by lamplight.',
    '{who} walked to the mosque through the snow for the night prayer, as most evenings.',
    'A wolf was heard above the {fam} fold. {who} sat up with the dog.',
    '{who} of {house} told the old story of the flood to the children again. They knew the ending and shouted it.',
    'Bread baked at the {fam} oven today; the smell went all down the lane.',
  ],
  quiet: [
    '{who} of {house} is turning the garden behind the house.',
    '{who} of {house} took the goats up to the high grass.',
    'Washing day at the spring. {who} of {house} brought the news, as usual.',
    'The {fam} roof is being re-mudded before the rains. {who} is on it, shouting down.',
  ],
  lean: [
    'At the {fam} house they have been eating thin soup since the week began.',
    'There was no smoke from the {fam} chimney this morning. {who} says they are saving wood.',
  ],
};

function laneLife(s: ValleyState, day: number) {
  const season = seasonOf(doyOf(day));
  const quiet = !s.notes.some((n) => dayOfMinute(n.at) >= day - 2 && n.kind !== 'weather');
  if (season !== 'winter' && !quiet) return;
  if (hashUnit(s.seed, DRAW.line, 77, day) > (season === 'winter' ? 0.3 : 0.4)) return;
  const homes = s.households.filter((h) => h.members.length && underSeal(s, h));
  const h = homes[Math.floor(hashUnit(s.seed, DRAW.line, 78, day) * homes.length)];
  if (!h) return;
  const people = h.members
    .map((id) => personOf(s, id))
    .filter((p): p is Person => !!p && p.body.alive && isAdult(p));
  const p = people[Math.floor(hashUnit(s.seed, DRAW.line, 79, day) * people.length)];
  if (!p) return;
  const pool =
    daysOfBread(s, h) < 25
      ? (LANE.lean ?? [])
      : season === 'winter'
        ? (LANE.winter ?? [])
        : (LANE.quiet ?? []);
  const line = pool[Math.floor(hashUnit(s.seed, DRAW.line, 80, day) * pool.length)] ?? '';
  note(s, {
    at: day * DAY + 20 * 60,
    kind: 'story',
    text: line
      .replace('{who}', p.name)
      .replace('{house}', h.name)
      .replace('{fam}', h.name.replace(/^the /, '').replace(/ house$/, '')),
    who: p.id,
    house: h.id,
    weight: 1,
  });
}

/** When a house's jars are empty, someone tells you: the reeve if he is living, else the coffeehouse talk. */
function hungerWord(s: ValleyState, day: number) {
  for (const h of s.households) {
    if (!h.members.length || daysOfBread(s, h) >= 1) continue;
    const key = `empty-${h.id}-${Math.floor(day / 30)}`;
    if (s.flags.beats.includes(key)) continue;
    s.flags.beats.push(key);
    const osman = personOf(s, 'osman');
    const by = osman?.body.alive && h.id !== 'kavak' ? 'Osman, at your door:' : 'Talk at the coffeehouse:';
    note(s, {
      at: day * DAY + 17 * 60,
      kind: 'knock',
      text: `${by} there is nothing left in the jars of ${h.name}. They are eating what the neighbours bring, and that is not much.`,
      house: h.id,
      weight: 3,
    });
  }
}

/** The granary passing half the due, and the whole due: the year's two good evenings at the konak. */
function granaryMilestones(s: ValleyState, day: number) {
  const y = yearOf(day);
  const r = s.agha.granary / Math.max(1, s.agha.due);
  const rider = nextRiderDay(s);
  for (const [at, key, text] of [
    [
      0.5,
      `half-${y}`,
      'The granary is past half the agha’s due. Osman stood in the doorway and counted the sacks twice.',
    ],
    [
      1,
      `full-${y}`,
      `The agha’s due is in the granary, with ${Math.max(0, rider - day)} days before his rider.`,
    ],
  ] as const) {
    if (r < at || s.flags.beats.includes(key) || rider - day < 0) continue;
    s.flags.beats.push(key);
    note(s, { at: day * DAY + 18 * 60, kind: 'harvest', text, weight: at === 1 ? 3 : 2 });
  }
}

export function ownFieldDuties(s: ValleyState, day: number) {
  const doy = doyOf(day);
  const season = seasonOf(doy);
  if (season !== 'harvest' && season !== 'threshing') return;
  const { rise, set } = daylight(doy);
  const stormNext = [0, 1, 2].some((k) => weatherOf(s.seed, day + k).sky === 'storm');
  for (const h of s.households) {
    if (h.field.standing < 1) continue;
    const frac = Math.min(1, h.field.standing / Math.max(1, h.field.size));
    for (const m of h.members) {
      const p = personOf(s, m);
      if (!p || !isAdult(p)) continue;
      p.agenda.commitments = p.agenda.commitments.filter(
        (c) => !(c.label === 'our own barley' && c.status === 'pending'),
      );
      promise(p, {
        kind: 'job',
        toId: 'household',
        label: 'our own barley',
        actions: ['reap'],
        from: day * DAY + rise,
        until: day * DAY + set - 60,
        importance: Math.min(0.95, 0.3 + 0.45 * frac + (stormNext ? 0.25 : 0)),
      });
    }
  }
}

function routineFor(_s: ValleyState, p: Person, day: number) {
  const season = seasonOf(doyOf(day));
  const adult = isAdult(p);
  if (!adult) {
    return {
      activities: [
        { action: 'play', minutes: 300, valence: 0.2 },
        { action: 'help', minutes: 120, skill: { id: 'farming', difficulty: 0.2 } },
      ],
    };
  }
  const work =
    season === 'winter'
      ? { action: 'tend', minutes: 240 }
      : {
          action: season === 'sowing' ? 'sow' : 'tend',
          minutes: 420,
          skill: { id: 'farming', difficulty: 0.3 },
        };
  return {
    activities: [work, { action: 'chat', minutes: 60, valence: 0.1 }, { action: 'eat', minutes: 60 }],
  };
}

function born(s: ValleyState, mother: Person, father: Person, h: Household, at: number) {
  const n = h.members.length + h.gone.length;
  const boy = hashUnit(s.seed, DRAW.person, strHash(mother.id), n) > 0.5;
  const pool = boy
    ? [
        'Ali',
        'Hüseyin',
        'Mehmet',
        'Yunus',
        'Emin',
        'Halit',
        'Osman',
        'Hasan',
        'İsa',
        'Cemal',
        'Nuri',
        'Kemal',
        'Hamza',
        'Bilal',
        'Adem',
        'Zeki',
      ]
    : [
        'Ayşe',
        'Fatma',
        'Hatice',
        'Gülsüm',
        'Elif',
        'Zehra',
        'Meryem',
        'Hacer',
        'Şerife',
        'Emine',
        'Nazlı',
        'Havva',
        'Rukiye',
        'Saliha',
        'Hanife',
        'Döndü',
      ];
  // A child is not given a name someone living in the valley already answers to.
  const living = new Set(s.people.filter((q) => q.body.alive).map((q) => q.name));
  const free = pool.filter((x) => !living.has(x));
  const names = free.length ? free : pool;
  const name = names[Math.floor(hashUnit(s.seed, DRAW.name, strHash(mother.id), n) * names.length)] ?? 'Ali';
  const id = `${h.id}-b${s.nextNote}`;
  const d = deliver(mother, { id, name }, Math.max(mother.now, at));
  if (!d) return;
  const tmp = createCommunity([mother, father]);
  const child = birth(tmp, mother, father, {
    id,
    name,
    seed: d.seed,
    bornAt: d.bornAt,
    now: d.bornAt,
    sex: boy ? 'male' : 'female',
  });
  child.retention = { trace: 0, chronicleDays: 31 };
  s.people.push(child);
  h.members.push(child.id);
  note(s, {
    at: d.bornAt,
    kind: 'birth',
    text: `${mother.name} of ${h.name} had a ${boy ? 'boy' : 'girl'}. They are calling ${boy ? 'him' : 'her'} ${name}.`,
    who: mother.id,
    house: h.id,
    weight: 2.5,
  });
  s.knocks.push({
    id: `k${s.nextNote}`,
    at: d.bornAt,
    personId: father.id,
    house: h.id,
    what: 'birth',
    words: 'Come and see the child, kahya, if you will.',
    until: d.bornAt + 3 * DAY,
  });
}

function weddings(s: ValleyState, day: number) {
  const at = day * DAY + 10 * 60;
  const single = (p: Person, sex: 'male' | 'female', lo: number, hi: number) =>
    p.body.alive && p.life.sex === sex && ageYears(p) >= lo && ageYears(p) <= hi && spousesOf(p).length === 0;
  const men = s.people.filter((p) => single(p, 'male', 19, 40));
  const women = s.people.filter((p) => single(p, 'female', 17, 34));
  const pairs: { a: Person; b: Person; score: number }[] = [];
  for (const a of men) {
    for (const b of women) {
      const ha = houseOfPerson(s, a.id);
      const hb = houseOfPerson(s, b.id);
      if (!ha || !hb || ha === hb) continue;
      if (!canMarry(a, b, MUSLIM_CUSTOM, { at }).ok) continue;
      const score = (attraction(a, b) + attraction(b, a)) / 2 + 0.4 * compatibility(a, b);
      pairs.push({ a, b, score });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  const used = new Set<string>();
  let n = 0;
  for (const { a, b, score } of pairs) {
    if (n >= 1 || used.has(a.id) || used.has(b.id)) continue;
    if (hashUnit(s.seed, DRAW.match, strHash(a.id + b.id), day) > score) continue;
    const t = Math.max(at, a.now, b.now);
    if (!marry(a, b, t, MUSLIM_CUSTOM).ok) continue;
    used.add(a.id);
    used.add(b.id);
    n++;
    const ha = houseOfPerson(s, a.id);
    const hb = houseOfPerson(s, b.id);
    if (!ha || !hb) continue;
    hb.members = hb.members.filter((m) => m !== b.id);
    hb.gone.push({ id: b.id, day, why: 'married-out' });
    ha.members.push(b.id);
    note(s, {
      at: t,
      kind: 'wedding',
      text: `${b.name} of ${hb.name} married ${a.name} of ${ha.name}. The drum was heard from the upper lanes.`,
      who: a.id,
      house: ha.id,
      weight: 2.5,
    });
    s.knocks.push({
      id: `k${s.nextNote}`,
      at: t,
      personId: a.id,
      house: ha.id,
      what: 'wedding',
      words: 'You’ll come to the wedding, kahya? It would be an honour.',
      until: t + DAY,
    });
  }
}

function riderComes(s: ValleyState, day: number) {
  const at = day * DAY + 11 * 60;
  const give = Math.min(s.agha.granary, s.agha.due);
  s.agha.granary -= give;
  s.agha.delivered += give;
  const short = s.agha.due - give;
  const owedBefore = s.agha.arrears ?? 0;
  if (s.agha.loan?.arrived) s.agha.loan.paid = true;
  s.agha.arrears = 0;
  if (short > 0.5 && short <= Math.max(8, s.agha.due * 0.05) && owedBefore === 0) {
    s.agha.arrears = Math.round(short);
    note(s, {
      at,
      kind: 'due',
      text: `The agha’s rider loaded ${Math.round(give)} kile and wrote ${Math.round(short)} against next year. “Once,” he said.`,
      weight: 3,
    });
  } else if (short > 0.5) {
    s.agha.missed++;
    note(s, {
      at,
      kind: 'due',
      text: `The agha’s rider loaded ${Math.round(give)} kile and wrote ${Math.round(short)} short in his book. He looked at you a long time before he rode out.`,
      weight: 3,
    });
  } else {
    note(s, {
      at,
      kind: 'due',
      text: `The agha’s rider loaded ${Math.round(give)} kile, the whole due. He drank his coffee and said nothing, which is praise.`,
      weight: 3,
    });
  }
  for (const a of s.asks) if (a.job === 'bring-share') a.closed = true;
}

// ---------- verbs (applied by the game at the input's minute) ----------

export function call(
  s: ValleyState,
  job: Job,
  houses: string[],
  opts: { wage?: boolean; days?: number } = {},
): Ask | undefined {
  const personIds: string[] = [];
  for (const hid of houses) {
    const h = houseOf(s, hid);
    if (!h || !underSeal(s, h)) continue;
    const who = job === 'bring-share' ? h.members.slice(0, 1) : h.members;
    for (const m of who) {
      const p = personOf(s, m);
      if (p?.body.alive && ageYears(p) >= 15) personIds.push(m);
    }
  }
  if (personIds.length === 0) return undefined;
  const id = `a${s.asks.length + 1}-${s.minute}`;
  const days = opts.days ?? (job === 'reap-agha' ? 6 : job === 'build-mill' ? 20 : 12);
  // The share is asked for until the rider comes, however early it is asked.
  const until =
    job === 'bring-share'
      ? Math.max(s.minute + days * DAY, nextRiderDay(s) * DAY + 10 * HOUR)
      : s.minute + days * DAY;
  const ask: Ask = {
    id,
    job,
    personIds,
    houses: [...houses],
    from: s.minute,
    until,
    wage: !!opts.wage,
    insisted: [],
    replies: {},
    hours: {},
  };
  s.asks.push(ask);
  for (const pid of personIds) {
    promote(s, pid);
    const p = personOf(s, pid);
    const c = communityOf(s);
    if (p) {
      // They hear the crier now and answer at once.
      c.interrupts[pid] = { at: Math.max(s.minute, p.now), reason: 'the kahya’s crier' };
    }
  }
  return ask;
}

export function insist(s: ValleyState, askId: string, pid: string): boolean {
  const ask = s.asks.find((a) => a.id === askId);
  if (!ask || ask.closed || ask.insisted.includes(pid)) return false;
  ask.insisted.push(pid);
  promote(s, pid);
  const p = personOf(s, pid);
  if (p) communityOf(s).interrupts[pid] = { at: Math.max(s.minute, p.now), reason: 'the kahya insisted' };
  return true;
}

/** Give grain from the granary to a house. */
export function give(s: ValleyState, hid: string, kile: number): number {
  const h = houseOf(s, hid);
  if (!h) return 0;
  const amt = Math.min(kile, s.agha.granary);
  if (amt <= 0) return 0;
  s.agha.granary -= amt;
  h.store += amt;
  s.stats.given = (s.stats.given ?? 0) + amt;
  for (const m of h.members) {
    const p = personOf(s, m);
    if (!p || !isAdult(p)) continue;
    adoptVoiceTrust(p, KAHYA, 0.9, 0.12);
    queuePercept(s, m, {
      at: s.minute,
      channel: 'social',
      kind: 'gift',
      actorId: KAHYA,
      targetId: m,
      valence: 0.5,
      salience: 0.7,
      summary: `the kahya gave us ${Math.round(amt)} kile from the agha’s granary`,
    });
  }
  for (const k of s.knocks) if (!k.answered && k.house === hid && k.what === 'grain') k.answered = 'gave';
  note(s, {
    at: s.minute,
    kind: 'gift',
    text: `You had ${Math.round(amt)} kile carried to ${h.name}.`,
    house: hid,
    weight: 1.5,
  });
  houseSpeaks(s, h, s.minute + 40, giftWords, 'when the sack came');
  return amt;
}

/** Write to the agha for grain: it comes in twelve days and is owed at the next rider with a quarter more. Once a year. */
export function borrow(s: ValleyState, kile: number): boolean {
  if (s.agha.loan && s.minute - s.agha.loan.asked < 300 * DAY) return false;
  const k = Math.max(20, Math.min(120, Math.round(kile)));
  s.agha.loan = { kile: k, owe: Math.round(k * 1.25), asked: s.minute, arrives: s.minute + 12 * DAY };
  s.agha.due = dueFor(s);
  note(s, {
    at: s.minute,
    kind: 'letter',
    text: `You wrote to the agha for ${k} kile against next year’s due. The letter went down with the miller’s boy.`,
    weight: 2,
  });
  return true;
}

/** Send someone away from the door with nothing. The house remembers it. */
export function turnAway(s: ValleyState, knockId: string): boolean {
  const k = s.knocks.find((x) => x.id === knockId);
  if (!k || k.answered) return false;
  k.answered = 'refused';
  const h = houseOf(s, k.house);
  for (const m of h?.members ?? []) {
    const p = personOf(s, m);
    if (!p || !isAdult(p)) continue;
    adoptVoiceTrust(p, KAHYA, 0, m === k.personId ? 0.2 : 0.1);
    queuePercept(s, m, {
      at: s.minute,
      channel: 'social',
      kind: 'harm',
      actorId: KAHYA,
      targetId: m,
      valence: -0.6,
      salience: 0.8,
      summary: 'the kahya sent us away from the door with nothing',
    });
  }
  note(s, {
    at: s.minute,
    kind: 'knock',
    text: `You sent ${personOf(s, k.personId)?.name ?? 'them'} away from the door with nothing.`,
    house: k.house,
    weight: 1.5,
  });
  if (k.what === 'grain') markHard(s, k.house);
  return true;
}

/** A knock nobody answered: they waited and went home. Remembered, though more softly than being sent away. */
function lapseKnocks(s: ValleyState, upTo: number) {
  for (const k of s.knocks) {
    if (k.answered || k.until > upTo) continue;
    k.answered = 'ignored';
    if (k.what !== 'grain') continue;
    const p = personOf(s, k.personId);
    if (p?.body.alive) {
      adoptVoiceTrust(p, KAHYA, 0, 0.08);
      queuePercept(s, p.id, {
        at: k.until,
        channel: 'social',
        kind: 'harm',
        actorId: KAHYA,
        targetId: p.id,
        valence: -0.4,
        salience: 0.6,
        summary: 'the kahya left us waiting at the door',
      });
    }
    if (k.what === 'grain') markHard(s, k.house);
    note(s, {
      at: k.until,
      kind: 'knock',
      text: `${p?.name ?? 'Someone'} of ${houseOf(s, k.house)?.name ?? 'a house'} waited at your door, and went back down the lane.`,
      house: k.house,
      weight: 2.5,
    });
  }
}

/** Send the reeve's men for a house's share: it is taken, whatever they say. */
export function seize(s: ValleyState, hid: string): number {
  const h = houseOf(s, hid);
  if (!h) return 0;
  const owe = Math.max(0, shareOwed(h) - h.paid);
  const amt = Math.min(h.store, owe);
  h.store -= amt;
  h.paid += amt;
  s.agha.granary += amt;
  s.stats.seized = (s.stats.seized ?? 0) + 1;
  markHard(s, hid);
  for (const m of h.members) {
    const p = personOf(s, m);
    if (!p || !isAdult(p)) continue;
    adoptVoiceTrust(p, KAHYA, 0, 0.35);
    queuePercept(s, m, {
      at: s.minute,
      channel: 'social',
      kind: 'harm',
      actorId: KAHYA,
      targetId: m,
      valence: -0.75,
      salience: 0.9,
      summary: `the kahya’s men took our share from the jars`,
    });
  }
  // The lane sees it.
  for (const o of s.households) {
    if (o === h || o.hamlet !== h.hamlet) continue;
    const head = o.members[0];
    if (!head) continue;
    queuePercept(s, head, {
      at: s.minute,
      channel: 'told',
      kind: 'harm',
      actorId: KAHYA,
      targetId: h.members[0] ?? h.id,
      valence: -0.3,
      salience: 0.6,
      summary: `the kahya’s men took ${h.name}’s share by force`,
    });
    const hp = personOf(s, head);
    if (hp) adoptVoiceTrust(hp, KAHYA, 0, 0.06);
  }
  note(s, {
    at: s.minute,
    kind: 'seize',
    text: `The reeve’s men took ${Math.round(amt)} kile from ${h.name}’s jars. The whole lane watched.`,
    house: hid,
    weight: 3,
  });
  houseSpeaks(s, h, s.minute + 30, seizeWords, 'in the doorway');
  return amt;
}

/** Ease a house's share this year (halve it). The other houses notice. */
export function ease(s: ValleyState, hid: string): boolean {
  const h = houseOf(s, hid);
  if (!h || h.eased) return false;
  h.eased = true;
  for (const m of h.members) {
    const p = personOf(s, m);
    if (!p || !isAdult(p)) continue;
    adoptVoiceTrust(p, KAHYA, 0.85, 0.1);
  }
  note(s, {
    at: s.minute,
    kind: 'gift',
    text: `You struck half of ${h.name}’s share from the ledger this year.`,
    house: hid,
    weight: 1.5,
  });
  houseSpeaks(s, h, s.minute + 60, easeWords, 'when the word came');
  // The lanes see it: one other house of the hamlet says what the lanes think, the next morning.
  const others = s.households.filter((o) => o !== h && o.hamlet === h.hamlet && o.members.length);
  const o = others[Math.floor(hashUnit(s.seed, DRAW.line, strHash(hid), s.minute) * others.length)];
  if (o) {
    const p = speakerOf(o, (id) => personOf(s, id));
    if (p) {
      const at = (dayOfMinute(s.minute) + 1) * DAY + 10 * HOUR;
      const kind = daysOfBread(s, h) < 40 ? 2 : daysOfBread(s, o) < daysOfBread(s, h) ? 0 : 1;
      const line = easeLaneWords(voiceCtx(s, o, p, at), p, kind);
      note(s, {
        at,
        kind: 'voice',
        text: line.replace(/:.*$/, ':'),
        words: line.replace(/^[^“]*“|”$/g, ''),
        house: o.id,
        weight: 2,
      });
    }
  }
  return true;
}

/** What is true for a house this season, for the person who answers the kahya (see voices.ts). */
function voiceCtx(s: ValleyState, h: Household, p: Person, at: number): VoiceContext {
  s.said ??= {};
  s.said.valley ??= {};
  const day = dayOfMinute(at);
  const recent = (n: Note, days: number) => n.house === h.id && dayOfMinute(n.at) >= day - days && n.at <= at;
  const birth = s.notes.findLast((n) => n.kind === 'birth' && recent(n, 40));
  const gone = Object.values(s.departed).filter((d) => d.house === h.id && d.day >= day - 60);
  const died = gone.findLast((d) => d.why === 'died' && d.day >= day - 40);
  const left = gone.findLast((d) => d.why === 'left');
  const needy = s.households
    .filter((o) => o !== h && o.hamlet === h.hamlet && o.members.length)
    .sort((a, b) => daysOfBread(s, a) - daysOfBread(s, b))[0];
  return {
    seed: s.seed,
    minute: at,
    said: s.said.valley ?? {},
    bread: daysOfBread(s, h),
    trust: p.will.voices.find((v) => v.voiceId === KAHYA)?.trust ?? 0.5,
    ...(birth
      ? {
          born: `${birth.text.match(/calling (?:him|her) ([^.]+)\./)?.[1] ?? 'the baby'} (${/had a boy/.test(birth.text) ? 'boy' : 'girl'})`,
        }
      : {}),
    ...(died ? { died: died.name } : {}),
    ...(left ? { left: left.name } : {}),
    ...(s.notes.some((n) => n.kind === 'wedding' && recent(n, 20)) ? { wed: true } : {}),
    ...(needy && daysOfBread(s, needy) < 40 ? { needy: needy.name.replace(/^the /, 'The ') } : {}),
  };
}

/** One named person of the house answers what the kahya just did. */
function houseSpeaks(
  s: ValleyState,
  h: Household,
  at: number,
  words: (ctx: VoiceContext, p: Person) => string,
  where: string,
) {
  const p = speakerOf(h, (id) => personOf(s, id));
  if (!p) return;
  const line = words(voiceCtx(s, h, p, at), p);
  if (!line) return;
  note(s, {
    at,
    kind: 'voice',
    text: `${p.name} of ${h.name}, ${where}:`,
    words: line,
    who: p.id,
    house: h.id,
    weight: 2.5,
  });
}

/** Walk to a house and sit with them. Returns the minute the kahya is back, or undefined if busy. */
export function visit(s: ValleyState, hid: string, why: Knock['what'] | 'call' = 'call'): number | undefined {
  const h = houseOf(s, hid);
  if (!h) return undefined;
  const ks = s.kahyaState;
  if (ks.visit && ks.visit.back > s.minute) return undefined;
  const walk = h.hamlet === 'upper' ? 75 : 20;
  const stay = why === 'wedding' ? 180 : why === 'death' ? 120 : 90;
  const arrive = s.minute + walk;
  const leave = arrive + stay;
  ks.visit = { house: hid, arrive, leave, back: leave + walk };
  const firstTime = ks.seen[hid] === undefined;
  ks.seen[hid] = arrive;
  houseSpeaks(s, h, arrive + 20, (ctx, p) => visitWords(ctx, p, h, firstTime), 'at the hearth');
  // What the kahya will remember of their jars: the read is as old as the visit.
  ks.guess ??= {};
  ks.guess[hid] = { at: arrive, bread: Math.round(daysOfBread(s, h)) };
  for (const m of h.members) {
    promote(s, m);
    const p = personOf(s, m);
    if (!p) continue;
    glimpseOf(s.kahya, p, Math.max(arrive, s.kahya.now), 1);
    if (!isAdult(p)) continue;
    const warm = why === 'death' ? 0.6 : why === 'wedding' || why === 'birth' ? 0.5 : 0.25;
    adoptVoiceTrust(p, KAHYA, 0.8, why === 'call' ? 0.04 : 0.1);
    queuePercept(s, m, {
      at: arrive,
      channel: 'social',
      kind: 'visit',
      actorId: KAHYA,
      targetId: m,
      valence: warm,
      salience: 0.6,
      summary:
        why === 'death'
          ? 'the kahya came to sit with us in our grief'
          : why === 'wedding'
            ? 'the kahya came to the wedding'
            : why === 'birth'
              ? 'the kahya came to see the baby'
              : 'the kahya came and sat with us',
    });
  }
  for (const k of s.knocks) if (!k.answered && k.house === hid && k.what !== 'grain') k.answered = 'went';
  // The kahya's own legs: the walk and the sitting are one activity.
  const k = s.kahya;
  if (k.now < s.minute) hfTick(k, s.minute);
  const aff = walkOffer(h, walk, stay);
  const rec = decide(k, [aff]);
  if (rec.chosenAffordanceId === aff.id) begin(k, aff, rec);
  return ks.visit.back;
}

/** The kahya's walk to a house and back, with the sitting. */
/** A guess, in the observer's own head, at how a person would answer an ask (HF `predictAs`; pure). */
export interface Hunch {
  verdict: SuggestionResolution['verdict'];
  reason: string;
  confidence: number;
}

export function hunchOf(
  s: ValleyState,
  observer: Person,
  target: Person,
  job: Job,
  wage = false,
): Hunch | undefined {
  const h = houseOfPerson(s, target.id);
  if (!h || !target.body.alive) return undefined;
  const dayStart = dayOfMinute(s.minute) * DAY;
  const { rise, set } = daylight(doyOf(dayOfMinute(s.minute)));
  // Asked now, they would weigh it at their next waking hour.
  let at = Math.max(s.minute, dayStart + rise + HOUR);
  if (at > dayStart + set - 2 * HOUR) at = dayStart + DAY + rise + 2 * HOUR;
  const ask: Ask = {
    id: 'hunch',
    job,
    personIds: [target.id],
    houses: [h.id],
    from: at,
    until: at + DAY,
    wage,
    insisted: [],
    replies: {},
    hours: {},
  };
  s.asks.push(ask);
  try {
    const offers = offersFor(s, target, at);
    const sug = suggestionFor(s, target, at);
    if (!sug) return undefined;
    const r = predictAs(observer, target, offers, sug, {
      now: Math.max(observer.now, s.minute),
      scarcity: scarcityOf(s, h),
    });
    return { verdict: r.resolution.verdict, reason: r.resolution.reason, confidence: r.confidence };
  } finally {
    s.asks.pop();
  }
}

export function walkOffer(h: Household, walk: number, stay: number): Affordance {
  return {
    id: `walk:${h.id}`,
    action: 'visit',
    label: `walk to ${h.name}`,
    placeId: `house:${h.id}`,
    duration: walk * 2 + stay,
    effort: h.hamlet === 'upper' ? 0.55 : 0.3,
    advertises: { belonging: 0.1 },
    tags: ['social', 'outdoors'],
  };
}

export { glimpseOf, perceive };
