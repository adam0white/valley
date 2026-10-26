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
  glimpsePerson,
  tick as hfTick,
  MUSLIM_CUSTOM,
  marry,
  type Outcome,
  type Percept,
  type Person,
  predictAs,
  pregnancyDue,
  promise,
  readBody,
  restore,
  routineDay,
  type SimEvent,
  type Suggestion,
  type SuggestionResolution,
  snapshot,
  spousesOf,
  stepCommunity,
  successChance,
  type World,
} from '@adam0white/human-framework';
import { allianceOffers, allianceSuggestion, allianceTick, resolveAlliance } from './alliance.ts';
import { type BrokeringState, brokerOffers, brokerTick, brokerVoices, resolveBroker } from './brokering.ts';
import {
  DAY,
  dateEnglish,
  daylight,
  dayOfMinute,
  doyOf,
  HOUR,
  minuteOfDay,
  seasonOf,
  weatherOf,
  yearOf,
} from './calendar.ts';
import { ALLOCATION, CAST_IDS, DISCLOSURES, localRole } from './cast.ts';
import { tellValleyDeath } from './death.ts';
import {
  captureDialogue,
  type DialogueState,
  dialogueHear,
  dialogueOffers,
  dialogueTick,
  resolveDialogue,
} from './dialogue.ts';
import {
  ALLIANCE_EDITION,
  captureTermReply,
  DIALOGUE_EDITION,
  type EditionState,
  millPay,
  passEdition,
  REPLY_EDITION,
  type RulesEdition,
  resolveTermWork,
  termDay,
  termOffers,
  termSuggestion,
} from './edition.ts';
import {
  captureIntroduction,
  type IntroductionState,
  introductionOffers,
  introductionSuggestion,
  introductionTick,
  resolveIntroduction,
} from './introductions.ts';
import { type PassState, passTick } from './pass.ts';
import { type CastStart, calendarPassport, lifeFacts, validateCastStart } from './passport.ts';
import { foundValley, type Household, householdLabel, KAHYA, makeKahya, personLabel } from './people.ts';
import { DRAW, hashUnit, mixSeed, strHash } from './rng.ts';
import { type StewardCare, stewardTo } from './steward.ts';
import {
  ASSENT,
  easeLaneWords,
  easeWords,
  giftWords,
  registerOf,
  rememberedLine,
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
  /** Several people answering the same way at once share one line (absent in older saves). */
  group?: string;
  names?: string[];
  /** For a grouped line, the people in it (same order as names). */
  ids?: string[];
}

export interface Knock {
  id: string;
  at: number;
  personId: string;
  house: string;
  what: 'grain' | 'wedding' | 'birth' | 'death';
  words: string;
  answered?: 'gave' | 'refused' | 'went' | 'ignored' | 'arranged';
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
  /** The kahya's own book of what he did to each house, last four (absent in older saves). */
  acts?: Record<string, { day: number; what: string }[]>;
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
  stewardCare?: StewardCare;
  pass?: PassState;
  brokering?: BrokeringState;
  introduction?: IntroductionState;
  edition?: EditionState;
  /** Explicit reply-only edition. Original grain rules remain unmarked. */
  dialogue?: DialogueState;
  reply?: { id: typeof REPLY_EDITION; visits: string[] };
  castFacts?: Record<string, ReturnType<typeof lifeFacts>>;
  castReleaseRequests?: string[];
  castReleased?: Record<string, Person>;
  castDeaths?: Record<string, Person>;

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
  /** Word is out that the kahya hands out the agha's grain: until this minute, people come to the door sooner. */
  openHand?: number;
  /** The kahya's gifts of the last ten days, for the giveaway word (absent in older saves). */
  gifts?: { at: number; kile: number }[];
  /** What came into the granary since the last weekly word (absent in older saves). */
  inflow?: { from: number; threshed: number; shares: number };
}

// ---------- founding ----------

export const START_MINUTE = 7 * HOUR;

export function newValley(
  seed: number,
  cast?: CastStart,
  preflight = false,
  plainEnglish = true,
  rules?: RulesEdition,
): ValleyState {
  if (community && communityFor) syncCommunity(communityFor);
  const { households, people } = foundValley(seed, 0);
  if (cast) {
    validateCastStart(people, cast, preflight);
    for (const record of ALLOCATION) {
      const index = people.findIndex((p) => p.id === localRole(record.castId));
      const initial = cast.people[record.castId];
      if (!initial || index < 0) throw new Error('Missing pinned cast actor.');
      people[index] = restore(initial);
    }
  }
  const kahya = makeKahya(seed, 0);
  // Opt in after admission, before any simulation. Full-save restoration bypasses this path.
  for (const p of [...people, kahya]) p.lexicon = { ...p.lexicon, plainEnglish };
  const s: ValleyState = {
    ...(rules && rules !== REPLY_EDITION && rules !== DIALOGUE_EDITION ? { edition: { id: rules } } : {}),
    ...(rules === REPLY_EDITION ? { reply: { id: REPLY_EDITION, visits: [] } } : {}),
    ...(rules === ALLIANCE_EDITION ? { stewardCare: { grain: 0, eaten: 0 } } : {}),
    ...(passEdition(rules) ? { pass: { stock: 3, stone: 0, grainReceived: 0 } } : {}),
    ...(rules === DIALOGUE_EDITION ? { dialogue: { id: DIALOGUE_EDITION, exchanges: [] } } : {}),
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
  s.castFacts = Object.fromEntries(
    (cast?.inputs ?? []).map((input) => [localRole(input.parent.castId), lifeFacts(input)]),
  );
  for (const p of people) {
    if (!CAST_IDS[p.id]) continue;
    const fact = s.castFacts[p.id];
    const action = roleActions(p.id)[fact?.life.assignment ?? 0];
    if (action)
      p.agenda.goals.push({
        id: 'valley-visit-work',
        label: fact?.assignment ?? 'the agreed visiting work',
        serves: ['competence'],
        advancedBy: [{ action, amount: 0.25 }],
        importance: 0.4,
        progress: 0,
        status: 'active',
        adoptedAt: p.now,
      });
  }
  s.agha.due = dueFor(s);
  // The reeve has lived among the lower lanes all his life: he has an impression of everyone there (clearest of kin).
  const osman = personOf(s, 'osman');
  if (osman) {
    for (const h of s.households) {
      if (h.hamlet !== 'lower') continue;
      for (const m of h.members) {
        const p = personOf(s, m);
        if (!p || p === osman || ['guests', 'water-guest'].includes(h.id) || p.id === 'maryam') continue;
        for (let k = 0; k < 4; k++)
          glimpsePerson(osman, p, -k * 30 * DAY, h.id === 'kavak' || h.id === 'ak' ? 0.9 : 0.6);
      }
    }
  }
  // The kahya has met the reeve once, at the agha's house in the city.
  if (osman) glimpsePerson(s.kahya, osman, -60 * DAY, 0.5);
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
/** A loan is owed at the first rider at least four months after it arrives (so a late loan covers this year). */
export function loanOwedAt(s: ValleyState, riderDay: number): number {
  const l = s.agha.loan;
  if (!l || l.paid) return 0;
  return l.arrives <= (riderDay - 120) * DAY ? l.owe : 0;
}

export function dueFor(s: ValleyState): number {
  const shares = s.households
    .filter((h) => (s.flags.upper || h.hamlet === 'lower') && h.members.length > 0)
    .reduce((a, h) => a + h.share, 0);
  return Math.round(
    V.aghaField * 0.7 +
      shares +
      (s.agha.arrears ?? 0) +
      loanOwedAt(s, nextRiderDay(s)) -
      (s.flags.beats.includes('mill-done') ? 40 : 0),
  );
}

// ---------- lookups ----------

export const personOf = (s: ValleyState, id: string) => s.people.find((p) => p.id === id);
export const houseOf = (s: ValleyState, id: string) => s.households.find((h) => h.id === id);
export const houseOfPerson = (s: ValleyState, pid: string) =>
  s.households.find((h) => h.members.includes(pid));
export const isAdult = (p: Person) => ageYears(p) >= 15;
export const underSeal = (s: ValleyState, h: Household) => s.flags.upper || h.hamlet === 'lower';

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

// HF role names remain unchanged in Person state. Capitalize them when they begin a note sentence.
const sentenceText = (text: string) =>
  text.replace(
    /(^|[.!?] )([a-z])/g,
    (_match, prefix: string, letter: string) => prefix + letter.toUpperCase(),
  );

export function note(s: ValleyState, n: Omit<Note, 'id'>) {
  s.notes.push({ ...n, text: sentenceText(n.text), id: s.nextNote++ });
  if (s.notes.length > 400) s.notes.splice(0, s.notes.length - 400);
}

// ---------- the asks ----------

export function hasOfficeCard(s: ValleyState): boolean {
  return (
    s.knocks.some((k) => !k.answered && k.at <= s.minute && k.until > s.minute) ||
    !!s.edition?.decisions?.some((d) => !d.answered && d.from <= s.minute && d.until > s.minute)
  );
}

export function openAsksFor(s: ValleyState, pid: string, at: number): Ask[] {
  return s.asks.filter((a) => !a.closed && a.from <= at && a.until > at && a.personIds.includes(pid));
}

function suggestionFor(s: ValleyState, p: Person, at: number): Suggestion | undefined {
  const intro = introductionSuggestion(s, p, at);
  const asks = openAsksFor(s, p.id, at);
  const a = asks[asks.length - 1];
  const term = termSuggestion(s, p, at);
  if (intro && (intro.since ?? -1) >= Math.max(a?.from ?? -1, term?.since ?? -1)) return intro;
  if (!a || (term && (term.since ?? -1) >= a.from)) return term;
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
    ...dialogueOffers(s, p, at),
    ...introductionOffers(s, p, at),
    ...brokerOffers(s, p, at),
    ...allianceOffers(s, p, at),
    ...termOffers(s, p, at),
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
  const fact = s.castFacts?.[p.id];
  const actions = roleActions(p.id);
  const chosen = actions[fact?.life.assignment ?? 0];
  const pendingActions = p.agenda.commitments
    .filter((c) => c.status === 'pending' && c.from <= at && c.until > at)
    .flatMap((c) => c.actions);
  const dueActions = actions.filter((action) => action === chosen || pendingActions.includes(action));
  if (light && !weak && !s.castReleased?.[p.id])
    for (const action of dueActions) {
      out.push({
        id: `role:${action}`,
        action,
        label: roleLabel(action),
        placeId: fact?.startsAtHome === false ? 'common' : home,
        duration: fact?.availableForExtraWork ? 60 : 120,
        effort: p.id === 'yusuf-usta' ? 0.1 : 0.3,
        advertises: { competence: 0.15, meaning: 0.12 },
        tags: ['work'],
      });
    }
  if (
    p.id === 'danyal' &&
    p.agenda.commitments.some(
      (c) =>
        c.kind === 'worship' &&
        c.normId === 'daily-prayer' &&
        c.status === 'pending' &&
        c.from <= at &&
        c.until > at,
    )
  ) {
    out.push({
      id: 'christian-prayer',
      action: 'christian-prayer',
      label: 'keep his own quiet prayer',
      placeId: home,
      duration: 15,
      effort: 0.05,
      advertises: { meaning: 0.1 },
      norms: [{ normId: 'daily-prayer', relation: 'fulfills' }],
      tags: ['worship'],
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
  if (light && !weak && h.field.size > 0 && season === 'sowing' && h.field.sown < 1) {
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
        label: p.id === 'yusuf' ? 'build the mill wall' : 'carry stone for the mill',
        placeId: 'mill',
        duration: 120,
        effort: 0.8,
        advertises: { esteem: 0.04, meaning: 0.03 },
        material: a.wage ? (s.edition ? Math.min(s.agha.granary, 0.3) : 1) : 0,
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
      (c) =>
        c.kind === 'worship' &&
        c.normId === 'salah' &&
        c.status === 'pending' &&
        c.from <= at &&
        c.until > at,
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
  // When word is out that the kahya hands out the agha's grain, a house goes to his door long before it is hungry,
  // and it costs less face (everyone is going); whether a person goes is still their own HF decision.
  const open = (s.openHand ?? 0) > p.now;
  if (
    daysOfBread(s, h) < (open ? 70 : 12) &&
    h.members[0] === p.id &&
    light &&
    !knockedLately(s, h.id, p.now)
  ) {
    out.push({
      id: 'ask-kahya',
      action: 'ask-kahya',
      label: 'go to the kahya’s door for grain',
      placeId: 'konak',
      duration: 50,
      effort: 0.2,
      advertises: { food: 0.2, esteem: open ? -0.08 : -0.25, safety: 0.15 },
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

function pauseCastAtBoundary(s: ValleyState, p: Person): boolean {
  const h = houseOfPerson(s, p.id);
  if (!h) return false;
  if (s.castReleaseRequests?.includes(p.id) && !p.activity && p.body.alive) {
    try {
      const passport = calendarPassport(p);
      if (
        passport.calendar.owed.length ||
        passport.calendar.lapse ||
        passport.calendar.commitments.some((c) => c.kind !== 'worship')
      )
        throw new Error('Unfinished material duty.');
      s.castReleased ??= {};
      s.castReleased[p.id] = snapshot(p);
      h.members = h.members.filter((id) => id !== p.id);
      s.departed[p.id] = { name: p.name, house: h.id, day: dayOfMinute(p.now), why: 'left' };
      h.gone.push({ id: p.id, day: dayOfMinute(p.now), why: 'left' });
      s.leaving.push(p.id);
      note(s, {
        at: p.now,
        kind: 'story',
        house: h.id,
        who: p.id,
        weight: 3,
        text: `${personLabel(p)} finishes the current task and ends the visit. The grain ${p.life.sex === 'female' ? 'she' : 'he'} did not use stays at the lodging. Any unfinished duties still apply.`,
      });
      return true;
    } catch {
      /* An actual goal, duty or health conflict must finish or stay here. */
    }
  }
  return false;
}

export function makeWorld(s: ValleyState): World {
  return {
    now: () => s.minute,
    affordancesFor: (p) => (pauseCastAtBoundary(s, p) ? [] : offersFor(s, p)),
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
      captureDialogue(s, p, offer, record);
      if (!captureIntroduction(s, p, offer, record) && !captureTermReply(s, p, offer, record))
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
  glimpsePerson(s.kahya, p, Math.max(reply.at, s.kahya.now), 0.5);
  // People pressed into it who now will not do it on your word share one line, not one line each.
  if (reply.verdict === 'refused' && reply.reason === 'distrust' && ask.insisted.includes(p.id)) {
    s.notes = s.notes.filter(
      (n) =>
        !(n.kind === 'reply' && n.ask === ask.id && n.who === p.id && !n.group && n.at >= reply.at - DAY),
    );
    const g = s.notes.findLast((n) => n.group === `pressed-${ask.id}` && n.at >= reply.at - 3 * HOUR);
    const names = [...(g?.names ?? []), p.name];
    const list = peopleList(names);
    const text =
      names.length === 1
        ? `${list} came when you pressed, and will not come again on your word today.`
        : `${list} came when you pressed. They will not come again on your word today.`;
    if (g) {
      g.names = names;
      g.text = text;
      g.weight = 3;
    } else
      note(s, {
        at: p.now,
        kind: 'reply',
        text,
        words,
        who: p.id,
        ...(h ? { house: h.id } : {}),
        weight: 2.5,
        ask: ask.id,
        group: `pressed-${ask.id}`,
        names,
      });
    return;
  }
  // One line per person per ask per day. Plain yeses and put-offs of one ask on one day share a line each (who came
  // is the news, not twenty copies of "I'll come"); a change of mind the same day takes the person out of that shared
  // line and gives them their own ("put it off, then came").
  const today = dayOfMinute(reply.at);
  let wasToday: Reply['verdict'] | undefined;
  for (const [key, verdict] of [
    [`came-${ask.id}-${today}`, 'assented'],
    [`off-${ask.id}-${today}`, 'deferred'],
  ] as const) {
    const g = s.notes.findLast((n) => n.group === key);
    const k = g?.ids?.indexOf(p.id) ?? -1;
    if (!g?.ids || k < 0) continue;
    if (verdict === reply.verdict) return;
    // Putting it off in the morning and coming by noon is just coming.
    if (!(verdict === 'deferred' && reply.verdict === 'assented')) wasToday = verdict;
    g.ids.splice(k, 1);
    g.names?.splice(k, 1);
    if (!g.ids.length) s.notes = s.notes.filter((n) => n !== g);
    else g.text = groupText(ask, verdict, g.names ?? []);
  }
  const mine = s.notes.findLast(
    (n) =>
      n.kind === 'reply' && !n.group && n.ask === ask.id && n.who === p.id && dayOfMinute(n.at) === today,
  );
  if (mine) {
    const first = (mine.was ?? prev?.verdict ?? reply.verdict) as Reply['verdict'];
    mine.was = first;
    mine.text = sentenceText(
      first === reply.verdict
        ? replyText(s, p, ask, reply)
        : `${personLabel(p, houseOfPerson(s, p.id))} ${PAST[first]?.(ask.job) ?? 'answered'}, then ${PAST[reply.verdict]?.(ask.job) ?? 'answered'}.`,
    );
    mine.words = words;
    mine.weight = Math.max(mine.weight, reply.verdict === 'refused' ? 3 : 2);
    return;
  }
  if (wasToday) {
    note(s, {
      at: p.now,
      kind: 'reply',
      text: `${personLabel(p, houseOfPerson(s, p.id))} ${PAST[wasToday]?.(ask.job) ?? 'answered'}, then ${PAST[reply.verdict]?.(ask.job) ?? 'answered'}.`,
      words,
      who: p.id,
      ...(h ? { house: h.id } : {}),
      weight: reply.verdict === 'refused' ? 3 : 2,
      ask: ask.id,
      was: wasToday,
    });
    return;
  }
  if (reply.verdict === 'assented' || reply.verdict === 'deferred') {
    const key = `${reply.verdict === 'assented' ? 'came' : 'off'}-${ask.id}-${today}`;
    const g = s.notes.findLast((n) => n.group === key);
    const names = [...(g?.names ?? []), p.name];
    const ids = [...(g?.ids ?? []), p.id];
    const text = groupText(ask, reply.verdict, names);
    if (g) {
      g.names = names;
      g.ids = ids;
      g.text = text;
      g.at = Math.max(g.at, p.now);
    } else
      note(s, {
        at: p.now,
        kind: 'reply',
        text,
        words,
        who: p.id,
        ...(h ? { house: h.id } : {}),
        weight: reply.verdict === 'assented' ? 1 : 1.5,
        ask: ask.id,
        group: key,
        names,
        ids,
      });
    return;
  }
  const weight = reply.verdict === 'refused' ? 3 : reply.verdict === 'complied' ? 2.5 : 2;
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

function residentLabel(p: Person, h: Household): string {
  const label = personLabel(p, h);
  return p.name === 'a household member' ||
    p.name === 'a child' ||
    h.id === 'water-guest' ||
    h.id === 'guests'
    ? label
    : `${label} of ${householdLabel(h)}`;
}

/** Group only visible labels; retain the original names in Note.names. */
export function peopleList(names: string[]): string {
  if (names.length === 1) return personLabel({ name: names[0] ?? 'someone' });
  const named = names.filter((name) => name !== 'a household member' && name !== 'a child');
  const shown = named.slice(0, 6).map((name) => personLabel({ name }));
  const others = names.length - shown.length;
  if (others) shown.push(`${others} ${shown.length ? 'other ' : ''}${others === 1 ? 'person' : 'people'}`);
  return shown.length === 1 ? (shown[0] ?? '') : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}

/** The shared line for one ask's plain yeses or put-offs on one day. */
function groupText(ask: Ask, verdict: 'assented' | 'deferred', names: string[]): string {
  const list = peopleList(names);
  if (verdict === 'deferred') return sentenceText(`${list} postponed ${JOB_WORK[ask.job]} today.`);
  const head =
    ask.job === 'reap-agha'
      ? 'came to cut the landowner’s barley today'
      : ask.job === 'build-mill'
        ? 'carried stone for the mill today'
        : 'brought grain to pay the landowner today';
  return sentenceText(`${list} ${head}.`);
}

/** A verdict as a past-tense clause, for a line that says someone changed their mind. */
const PAST: Record<string, (job: Job) => string> = {
  assented: (job) => (job === 'bring-share' ? 'carried the share down' : 'came'),
  complied: () => 'came because you pressed',
  deferred: (job) => `postponed ${JOB_WORK[job]}`,
  modified: (job) => (job === 'bring-share' ? 'brought half' : 'did something else'),
  refused: () => 'refused the request',
};

const JOB_WORK: Record<Job, string> = {
  'reap-agha': 'cutting the landowner’s barley',
  'build-mill': 'carrying stone for the mill',
  'bring-share': 'bringing the grain payment',
};

function replyText(s: ValleyState, p: Person, ask: Ask, r: Reply): string {
  const name = personLabel(p, houseOfPerson(s, p.id));
  const job =
    ask.job === 'reap-agha'
      ? 'cut the landowner’s barley'
      : ask.job === 'build-mill'
        ? 'carry stone for the mill'
        : 'bring the grain payment';
  switch (r.verdict) {
    case 'assented':
      return ask.job === 'bring-share' ? `${name} carried the share down.` : `${name} came to ${job}.`;
    case 'complied':
      return `${name} came slowly to ${job} because you insisted.`;
    case 'deferred':
      return `${name} postponed ${JOB_WORK[ask.job]}.`;
    case 'modified':
      return ask.job === 'bring-share' ? `${name} brought half.` : `${name} did something else instead.`;
    case 'refused':
      return `${name} refused the request.`;
    default:
      return `${name} answered.`;
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
      const key = rememberedLine(line);
      if (today[key] !== day) {
        today[key] = day;
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
    return pick([
      'I’ll come because you insist.',
      'I’m coming. Don’t stand over me.',
      'I’ll do as you say, steward.',
    ]);
  if (r.verdict === 'modified') {
    if (ask.job === 'bring-share')
      return pick([
        'I can bring half now. I’ll bring the rest when I can.',
        'Take half. We have people to feed.',
      ]);
    return r.says;
  }
  if (r.reason.startsWith('commitment:')) {
    const cid = r.reason.slice('commitment:'.length);
    const c = p.agenda.commitments.find((x) => x.id === cid);
    if (c?.label === 'our own barley')
      return pick([
        'We must cut our own barley first. Then we can cut the landowner’s.',
        'We must finish our own field first. It’s ripe too.',
        'My barley will rot, steward. I must cut it first.',
      ]);
    if (c?.label) return `I must finish ${c.label} first. I can come after that.`;
  }
  if (r.reason.startsWith('material') || r.reason === 'need:safety') {
    if (ask.job === 'bring-share')
      return pick([
        'I cannot bring it yet. Winter is long.',
        'We barely have enough food for ourselves, steward.',
        'Give me till the threshing is done.',
      ]);
    return pick([
      'We must cut our own barley first. Then we can cut the landowner’s.',
      'Who will feed my family while I cut his barley?',
    ]);
  }
  if (r.reason === 'distrust' && ask.insisted.includes(p.id))
    return pick([
      'I already did what you asked once, steward. That was enough.',
      'I came when you insisted. Look what happened to me.',
      'I will not come just because you ask. I will not come today.',
      'I did it your way once.',
    ]);
  if (r.reason === 'distrust')
    return pick([
      'The last steward said that too.',
      'I remember what your office took.',
      'No. I will not do it for you.',
    ]);
  if (r.reason.startsWith('capacity'))
    return pick(['I can’t work. My back hurts too much.', 'I have no strength left today.']);
  if (r.reason.startsWith('need:food'))
    return pick(['How can I work without food? Let me eat first.', 'I haven’t eaten.']);
  if (r.reason.startsWith('need:sleep') || r.reason.startsWith('need:rest'))
    return pick(['I am too tired to work.', 'Let me rest first.']);
  if (h && daysOfBread(s, h) < 20) return 'There’s no bread in the house, steward.';
  return r.says;
}

function resolveActivity(s: ValleyState, p: Person, act: Activity, reason: 'ended' | 'interrupted'): Outcome {
  const dialogue = resolveDialogue(s, p, act, reason);
  if (dialogue) return dialogue;
  const broker = resolveBroker(s, p, act, reason);
  if (broker) return broker;
  const road = resolveAlliance(s, p, act, reason);
  if (road) return road;
  const intro = resolveIntroduction(s, p, act, reason);
  if (intro) return intro;
  const term = resolveTermWork(s, p, act, reason);
  if (term) return term;
  const now = p.now;
  const base: Outcome = { affordanceId: act.affordanceId, action: act.action, status: 'completed', at: now };
  if (act.targetId !== undefined) base.targetId = act.targetId;
  const span = Math.max(1, act.endsAt - act.startedAt);
  const progress = reason === 'interrupted' ? Math.max(0, Math.min(1, (now - act.startedAt) / span)) : 1;
  const hours = (span * progress) / 60;
  const h = houseOfPerson(s, p.id);
  if (reason === 'interrupted') base.status = 'interrupted';
  if (roleActions(p.id).includes(act.action))
    return { ...base, needs: { competence: 0.06 * progress, meaning: 0.04 * progress } };
  switch (act.action) {
    case 'christian-prayer':
      return { ...base, needs: { meaning: 0.1 * progress } };
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
      const before = s.agha.mill;
      s.agha.mill = Math.min(
        V.millHours,
        s.agha.mill +
          hours * (act.protest ? 0.6 : 1) * (1 + Math.min(1, p.skills.building?.level ?? 0) * 0.25),
      );
      const ask = openAsksFor(s, p.id, act.startedAt).find((a) => a.job === 'build-mill');
      if (ask) ask.hours[p.id] = (ask.hours[p.id] ?? 0) + hours;
      const material = ask?.wage
        ? millPay(s, p.id, `${p.id}:${act.startedAt}:${act.endsAt}`, s.agha.mill - before, reason === 'ended')
        : 0;
      return { ...base, ...(s.edition && ask?.wage ? { material } : {}), needs: { competence: 0.03 } };
    }
    case 'bring-share': {
      if (!h || reason === 'interrupted') return { ...base, status: 'interrupted' };
      const owe = Math.max(0, shareOwed(h) - h.paid);
      const amt = Math.min(h.store, act.affordanceId === 'bring-half' ? owe / 2 : owe);
      h.store -= amt;
      h.paid += amt;
      s.agha.granary += amt;
      inflow(s, 'shares', amt);
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
          text: `At dusk ${personLabel(p, houseOfPerson(s, p.id))} went down to the mosque, as he does.`,
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
          'Steward, there is no grain in the jar. The children need food.',
          'I wouldn’t come if I had a choice.',
          'Lend us some grain. We will pay you back when we separate the grain from the cut barley.',
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
          text: `${residentLabel(p, h)} came to your door.`,
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
      text: `${residentLabel(p, h)} left for the city at first light.`,
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
    const asked =
      s.asks.some((a) => !a.closed && a.until > at && a.houses.includes(h.id)) ||
      s.edition?.requests?.some(
        (r) => r.house === h.id && r.until > at && (r.status === 'pending' || r.status === 'working'),
      );
    const visited = (s.kahyaState.seen[h.id] ?? -1e9) > at - 7 * DAY;
    const hungry = daysOfBread(s, h) < 40;
    const birthNear = h.members.some((m) => {
      const p = personOf(s, m);
      const due = p?.family?.pregnancy?.dueAt;
      return due !== undefined && due < at + 5 * DAY;
    });
    const hasCast = h.members.some((id) => !!CAST_IDS[id]);
    const introduced =
      (s.introduction?.status === 'invited' ||
        (s.brokering && ['guardian', 'proposal', 'answer', 'ceremony'].includes(s.brokering.phase))) &&
      h.members.some((id) => ['ali', 'esma', 'omer'].includes(id));
    const lived =
      introduced || hasCast || (busy && underSeal(s, h)) || asked || visited || hungry || birthNear;
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
    dialogueHear(s);
    const c = communityOf(s);
    const suggestions: Record<string, Suggestion | readonly Suggestion[]> = {};
    for (const p of c.people) {
      const sg = suggestionFor(s, p, stepTo);
      const voices = brokerVoices(s, p, stepTo);
      const road = allianceSuggestion(s, p);
      if (road) voices.push(road);
      if (voices.length) suggestions[p.id] = [...(sg ? [sg] : []), ...voices];
      else if (sg) suggestions[p.id] = sg;
    }
    const ev = stepCommunity(c, worldOf(s), stepTo, {
      suggestions,
      lifecourse: { mortality: true },
      maxEvents: 4000,
      contagion: false,
    });
    for (const e of ev) if (e.kind === 'died' || e.kind === 'finish') events.push(e);
    dialogueHear(s);
    dialogueTick(s, stepTo, ev);
    kahyaTo(s, stepTo);
    s.minute = stepTo;
    afterStep(s, ev);
    passTick(s);
    introductionTick(s);
    brokerTick(s);
    allianceTick(s);
    if (stepTo === midnight) endOfDay(s, day);
  }
  return events;
}

/** The kahya lives only his walks: time passes, and a walk is a real HF activity so his legs tire. */
function kahyaTo(s: ValleyState, to: number) {
  if (s.stewardCare) {
    stewardTo(s, to);
    return;
  }
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
  tellValleyDeath(s.people, p, at);
  if (CAST_IDS[p.id]) {
    s.castDeaths ??= {};
    s.castDeaths[p.id] = snapshot(p);
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
    text: `${residentLabel(p, h)} died${age >= 60 ? ', old' : age < 5 ? ', a small child' : ''}${hungry ? ', while the household had very little food left' : ''}. They buried ${p.life.sex === 'female' ? 'her' : 'him'} ${p.id === 'danyal' ? 'with his Christian observance respected' : 'before the evening prayer'}.`,
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
    words: 'They will sit with the family for three days.',
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
        text: `People from ${g.name} carried barley to ${hungry.name} after dark. Nobody said anything about it.`,
        house: hungry.id,
        weight: 1.5,
      });
      break;
    }
  }
}

function endOfDay(s: ValleyState, day: number) {
  const at = (day + 1) * DAY;
  // A thirty-day visit is real bounded fiction, not an indefinite landless household.
  if (day >= 29)
    for (const id of ['maryam', 'yusuf-usta', 'meryem-visitor', 'samira', 'danyal'])
      requestCastRelease(s, id);
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
      text: `The landowner’s man came up with ${s.agha.loan.kile} grain measures on two mules. The letter says you must repay ${s.agha.loan.owe} grain measures when the rider next comes.`,
      weight: 3,
    });
  }
  termDay(s, day);
  eveningTally(s, day);
  laneLife(s, day);
  inflowWord(s, day);
  if (day === s.agha.dueDay - 25) forecastWord(s, day);
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
            ? `The storm came over the ridge in the night. It flattened uncut barley worth about ${Math.round(lost)} grain measures in the landowner’s field.${houses ? ` It also flattened barley in ${houses} household fields.` : ''}`
            : 'The storm came over the ridge in the night and flattened the uncut barley.',
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
    inflow(s, 'threshed', t);
  }
  if (doy === 216) {
    note(s, {
      at: next * DAY + 6 * 60,
      kind: 'harvest',
      text: 'People began separating grain from the cut barley. Oxen walked in circles all day. The empty husks blew down the valley.',
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
    const owed = (s.agha.arrears ?? 0) + loanOwedAt(s, s.agha.dueDay);
    note(s, {
      at: next * DAY + 8 * 60,
      kind: 'letter',
      text: `The landowner’s letter says his due for the year is ${s.agha.due} grain measures by ${dateEnglish(s.agha.dueDay)}. This includes his own field and every house’s share${owed ? `, and ${owed} still owed to him from before` : ''}${s.flags.beats.includes('mill-done') ? ', less forty for the mill' : ''}.`,
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
  const who = n <= 12 ? `${COUNT[n]} ${n === 1 ? 'person' : 'people'}` : 'More than a dozen people';
  const left = s.agha.standing;
  const cutKey = `cut-${yearOf(day)}`;
  if (s.flags.beats.includes(cutKey)) return;
  if (left < 3) s.flags.beats.push(cutKey);
  // The first evening of a harvest is where a new kahya learns that the work counts: it heads the day.
  const firstKey = `first-cut-${yearOf(day)}`;
  const firstCut = !s.flags.beats.includes(firstKey);
  if (firstCut) s.flags.beats.push(firstKey);
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
    text: `${who} worked the landowner’s field today. ${cut}`,
    weight: left < 3 ? 2.5 : firstCut ? 3 : 2,
  });
}

/** The lanes when nothing is asked of them: in winter, and on quiet stretches, someone's evening, every few days. */
const LANE: Record<string, [number, string][]> = {
  winter: [
    [20, '{who} of {house} is weaving cloth beside the stove. You can hear the work from the lane.'],
    [16, 'Snow covers the upper lanes. The {fam} children slid down the snow on a tray until dark.'],
    [21, 'People played backgammon late at the coffeehouse. {who} lost and blamed the dice.'],
    [19, '{who} of {house} repaired the wooden frame that joins the oxen by lamplight.'],
    [20, '{who} walked to the mosque through the snow for the night prayer, as on most evenings.'],
    [22, 'Someone heard a wolf above the {fam} sheep pen. {who} stayed awake with the dog.'],
    [
      20,
      '{who} of {house} told the old story of the flood to the children again. They knew the ending and shouted it.',
    ],
    [11, 'People baked bread at the {fam} oven today. The smell spread down the lane.'],
    [14, '{who} of {house} went up for firewood and came back with a hare as well.'],
  ],
  spring: [
    [10, '{who} of {house} is digging the soil in the garden behind the house.'],
    [9, 'People are washing clothes at the spring. {who} of {house} brought back all the news.'],
    [7, 'The {fam} sheep are giving birth. {who} has not slept properly in a week.'],
    [12, '{who} of {house} planted beans along the wall. The hens are already after them.'],
  ],
  summer: [
    [8, '{who} of {house} took the goats up to the high grass.'],
    [13, 'It was too hot to work at noon. {who} slept in the shade of the {fam} walnut.'],
    [9, 'People are washing clothes at the spring. {who} of {house} brought back all the news.'],
  ],
  autumn: [
    [
      10,
      'The {fam} roof is getting a new layer of mud before the rains. {who} is on the roof, shouting down.',
    ],
    [11, '{who} of {house} is drying apricots on the roof.'],
    [15, '{who} of {house} took a donkey loaded with grapes down to the pot for making grape syrup.'],
  ],
  lean: [
    [19, 'At the {fam} house they have been eating thin soup since the week began.'],
    [8, 'There was no smoke from the {fam} chimney this morning. {who} says the household is saving wood.'],
  ],
};

export function laneLife(s: ValleyState, day: number) {
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
  const key =
    daysOfBread(s, h) < 25
      ? 'lean'
      : season === 'winter'
        ? 'winter'
        : season === 'spring'
          ? 'spring'
          : season === 'summer' || season === 'harvest'
            ? 'summer'
            : 'autumn';
  const pool = LANE[key] ?? [];
  s.said ??= {};
  s.said.lanes ??= {};
  const said = s.said.lanes;
  const start = Math.floor(hashUnit(s.seed, DRAW.line, 80, day) * pool.length);
  for (let i = 0; i < pool.length; i++) {
    const [hour, line] = pool[(start + i) % pool.length] ?? [0, ''];
    if (
      line.includes('mosque') &&
      !p.agenda.commitments.some((c) => c.kind === 'worship' && c.normId === 'salah')
    )
      continue;
    const lineKey = rememberedLine(line);
    if (said[lineKey] !== undefined && day - (said[lineKey] ?? 0) < 45) continue;
    said[lineKey] = day;
    note(s, {
      at: day * DAY + hour * 60,
      kind: 'story',
      text: line
        .replace('{who} of {house}', residentLabel(p, h))
        .replace('{who}', personLabel(p, h))
        .replace('{house}', householdLabel(h))
        .replace('{fam}', h.name.replace(/^the /, '').replace(/ house$/, '')),
      who: p.id,
      house: h.id,
      weight: 1,
    });
    return;
  }
}

function inflow(s: ValleyState, k: 'threshed' | 'shares', kile: number) {
  if (kile <= 0) return;
  s.inflow ??= { from: dayOfMinute(s.minute), threshed: 0, shares: 0 };
  s.inflow[k] += kile;
}

const about = (k: number) => (k < 15 ? 'a few sacks' : `about ${Math.round(k / 10) * 10} grain measures`);

/** Once a week while grain is coming in, The reeve says where the granary's new sacks came from. */
function inflowWord(s: ValleyState, day: number) {
  const f = s.inflow;
  if (!f || day - f.from < 6 || f.threshed + f.shares < 5) return;
  delete s.inflow;
  const parts = [
    f.threshed >= 5
      ? `the threshing floor brought in ${about(f.threshed)} of the landowner’s own barley`
      : '',
    f.shares >= 5 ? `the houses brought ${about(f.shares)} in shares` : '',
  ].filter(Boolean);
  note(s, {
    at: day * DAY + 18 * 60,
    kind: 'harvest',
    text: `The local overseer gives his count for the week: ${parts.join(', and ')}. It is all in the granary.`,
    who: 'osman',
    weight: 1.5,
  });
}

/**
 * Twenty-five days before the rider, the reeve does the sums aloud: what the granary will hold if every unpaid share
 * comes in and the agha's sheaves are threshed, against the due, and what the gap is made of. A short forecast opens
 * the agha's loan as a lever (it costs a quarter more next year).
 */
function forecastWord(s: ValleyState, day: number) {
  const unpaid = s.households
    .filter((h) => underSeal(s, h) && h.members.length)
    .reduce((a, h) => a + Math.max(0, Math.min(h.store, shareOwed(h) - h.paid)), 0);
  const will = s.agha.granary + s.agha.reaped + unpaid;
  const gap = s.agha.due - will;
  const loan = s.agha.loan?.arrived ? loanOwedAt(s, s.agha.dueDay) : 0;
  const text =
    gap <= 5
      ? `The local overseer did the sums on the threshing floor. If the remaining shares come in and the landowner’s cut barley is separated into grain, the granary will hold his due, ${gap < -40 ? 'with room to spare' : 'just'}.`
      : `The local overseer did the sums on the threshing floor. Even if every share comes in and all the cut barley is separated into grain, the granary will still be ${about(gap)} short when the rider comes.${loan ? ` The loan is ${loan} of what he wants.` : ''}${s.agha.standing > 20 ? ' There is barley still standing in his field.' : ''} The landowner will lend grain if you write to him. You must repay it when next year’s rider comes, with a quarter more.`;
  note(s, { at: day * DAY + 17 * 60, kind: 'story', text, who: 'osman', weight: gap > 5 ? 3 : 2 });
  if (gap > 5 && !s.flags.verbs.includes('borrow')) s.flags.verbs.push('borrow');
}

/** When a house's jars are empty, someone tells you: the reeve if he is living, else the coffeehouse talk. */
function hungerWord(s: ValleyState, day: number) {
  for (const h of s.households) {
    if (!h.members.length || daysOfBread(s, h) >= 1) continue;
    const key = `empty-${h.id}-${Math.floor(day / 30)}`;
    if (s.flags.beats.includes(key)) continue;
    s.flags.beats.push(key);
    const osman = personOf(s, 'osman');
    const by =
      osman?.body.alive && h.id !== 'kavak'
        ? 'The local overseer says at your door:'
        : 'People at the coffeehouse say:';
    note(s, {
      at: day * DAY + 17 * 60,
      kind: 'knock',
      text: `${by} there is nothing left in the jars of ${householdLabel(h)}. They are eating what the neighbours bring, and that is not much.`,
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
      'The granary holds more than half the landowner’s due. The local overseer stood in the doorway and counted the sacks twice.',
    ],
    [
      1,
      `full-${y}`,
      `The landowner’s due is in the granary. His rider arrives in ${Math.max(0, rider - day)} days.`,
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
  // Preserve this run’s narration choice, including restored runs without the opt-in.
  if (mother.lexicon?.plainEnglish !== undefined)
    child.lexicon = { plainEnglish: mother.lexicon.plainEnglish };
  child.retention = { trace: 0, chronicleDays: 31 };
  s.people.push(child);
  h.members.push(child.id);
  note(s, {
    at: d.bornAt,
    kind: 'birth',
    text: `${residentLabel(mother, h)} had a ${boy ? 'boy' : 'girl'}. The family is calling ${boy ? 'him' : 'her'} ${name}.`,
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
    words: 'Come and see the child, steward, if you will.',
    until: d.bornAt + 3 * DAY,
  });
}

function weddings(s: ValleyState, day: number) {
  // This edition offers introductions; it never converts automatic matching into consent.
  if (passEdition(s.edition?.id)) return;
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
      text: `${residentLabel(b, hb)} married ${residentLabel(a, ha)}. The drum was heard from the upper lanes.`,
      who: a.id,
      house: ha.id,
      weight: 2.5,
    });
    // The invitation comes from whichever house is under your seal (the groom's first).
    const [hostP, hostH] = underSeal(s, ha) ? [a, ha] : underSeal(s, hb) ? [b, hb] : [undefined, undefined];
    if (hostP && hostH)
      s.knocks.push({
        id: `k${s.nextNote}`,
        at: t,
        personId: hostP.id,
        house: hostH.id,
        what: 'wedding',
        words: 'You’ll come to the wedding, steward? It would be an honour.',
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
  if (s.agha.loan?.arrived && loanOwedAt(s, day) > 0) s.agha.loan.paid = true;
  s.agha.arrears = 0;
  if (short > 0.5 && short <= Math.max(8, s.agha.due * 0.05) && owedBefore === 0) {
    s.agha.arrears = Math.round(short);
    note(s, {
      at,
      kind: 'due',
      text: `The landowner’s rider loaded ${Math.round(give)} grain measures and recorded that ${Math.round(short)} must be paid next year. “I will allow this once,” he said.`,
      weight: 3,
    });
  } else if (short > 0.5) {
    s.agha.missed++;
    note(s, {
      at,
      kind: 'due',
      text: `The landowner’s rider loaded ${Math.round(give)} grain measures and wrote in his book that you had paid ${Math.round(short)} grain measures too little. He looked at you a long time before he rode out.`,
      weight: 3,
    });
  } else {
    note(s, {
      at,
      kind: 'due',
      text: `The landowner’s rider loaded ${Math.round(give)} grain measures, the whole due. He drank his coffee and said nothing. You take his silence as praise.`,
      weight: 3,
    });
  }
  for (const a of s.asks) if (a.job === 'bring-share') a.closed = true;
  // Next year's due, as it stands now (the loan is paid, arrears are written): the ledger never shows a stale due.
  s.agha.due = dueFor(s);
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
      if (p?.body.alive && ageYears(p) >= 15 && p.id !== 'yusuf-usta') personIds.push(m);
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
  const ph = houseOfPerson(s, pid);
  if (ph) actOn(s, ph.id, `pressed ${personOf(s, pid)?.name ?? 'them'}`);
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
  const before = daysOfBread(s, h);
  const knocked = s.knocks.some(
    (k) => !k.answered && k.house === hid && k.what === 'grain' && k.at <= s.minute,
  );
  s.agha.granary -= amt;
  s.stats.given = (s.stats.given ?? 0) + amt;
  for (const k of s.knocks) if (!k.answered && k.house === hid && k.what === 'grain') k.answered = 'gave';
  actOn(s, hid, 'gave');
  const said = (ctx: VoiceContext, p: Person) =>
    giftWords({ ...ctx, bread: knocked ? Math.min(before, 20) : before }, p);
  // A house with full jars does not keep the agha's grain: it carries it on to the hungriest house of its hamlet
  // that evening, or, if nobody is short, sends it back up the lane.
  if (before >= 150 && !knocked) {
    const needy = s.households
      .filter((o) => o !== h && o.hamlet === h.hamlet && o.members.length && daysOfBread(s, o) < 60)
      .sort((x, y) => daysOfBread(s, x) - daysOfBread(s, y))[0];
    houseSpeaks(s, h, s.minute + 40, said, 'when the grain arrives');
    if (needy) {
      needy.store += amt;
      thank(s, needy, amt, `the kahya’s grain came to us by way of ${h.name}`);
      note(s, {
        at: s.minute,
        kind: 'gift',
        text: `You had ${Math.round(amt)} grain measures carried to ${householdLabel(h)}. They carried it on to ${needy.name} before dark.`,
        house: hid,
        weight: 2,
      });
    } else {
      s.agha.granary += amt;
      s.stats.given -= amt;
      note(s, {
        at: s.minute,
        kind: 'gift',
        text: `You had ${Math.round(amt)} grain measures carried to ${householdLabel(h)}. The sack came back up the lane before dark.`,
        house: hid,
        weight: 1.5,
      });
    }
    openHandWord(s, needy ? amt : 0);
    return amt;
  }
  h.store += amt;
  thank(s, h, amt, `the kahya gave us ${Math.round(amt)} kile from the agha’s granary`);
  note(s, {
    at: s.minute,
    kind: 'gift',
    text: `You had ${Math.round(amt)} grain measures carried to ${householdLabel(h)}.`,
    house: hid,
    weight: 1.5,
  });
  houseSpeaks(s, h, s.minute + 40, said, 'when the grain arrives');
  openHandWord(s, amt);
  return amt;
}

function thank(s: ValleyState, h: Household, amt: number, summary: string) {
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
      valence: amt >= 3 ? 0.5 : 0.3,
      salience: 0.7,
      summary,
    });
  }
}

/** What the kahya did to a house, kept in his own book (the house card shows the last of it). */
function actOn(s: ValleyState, hid: string, what: string) {
  const ks = s.kahyaState;
  ks.acts ??= {};
  const list = ks.acts[hid] ?? [];
  list.push({ day: dayOfMinute(s.minute), what });
  ks.acts[hid] = list.slice(-4);
}

/**
 * A giveaway is noticed: when thirty kile or more of the agha's grain went down the lanes in ten days, The reeve says
 * so at the granary door, the spring talks about it the next morning, and for ten days houses come to the door long
 * before they are hungry (an edge kept playable: owner direction 2026-10-19).
 */
function openHandWord(s: ValleyState, amt: number) {
  const day = dayOfMinute(s.minute);
  s.gifts = [
    ...(s.gifts ?? []).filter((x) => x.at >= s.minute - 10 * DAY),
    ...(amt > 0 ? [{ at: s.minute, kile: amt }] : []),
  ];
  const recent = s.gifts.reduce((a, x) => a + x.kile, 0);
  if (recent < 30) return;
  const key = `open-hand-${Math.floor(day / 30)}`;
  if (s.flags.beats.includes(key)) return;
  s.flags.beats.push(key);
  s.openHand = s.minute + 10 * DAY;
  note(s, {
    at: s.minute + 30,
    kind: 'story',
    text: `The local overseer speaks at the granary door: “That’s ${about(recent)} gone down the lanes since ${dateEnglish(day - 10)}, steward. I’m only counting. The rider will count too.”`,
    who: 'osman',
    weight: 2.5,
  });
  note(s, {
    at: (day + 1) * DAY + 9 * 60,
    kind: 'story',
    text: 'People at the spring say: “The steward is handing out the landowner’s barley. Go up before the rider comes and the gifts stop.”',
    weight: 2.5,
  });
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
    text: `You wrote to the landowner for ${k} grain measures, to be paid back with a quarter more at ${loanOwedAt(s, s.agha.dueDay) ? 'this year’s rider. His due grows by that much' : 'next year’s rider, not this one'}. The letter went down with the miller’s boy.`,
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
  if (k.what !== 'grain') {
    // Regrets for a wedding, a birth or a mourning: polite, and a little remembered.
    const host = personOf(s, k.personId);
    if (host?.body.alive) adoptVoiceTrust(host, KAHYA, 0.25, k.what === 'death' ? 0.08 : 0.03);
    actOn(s, k.house, k.what === 'wedding' ? 'sent regrets for the wedding' : 'sent word instead of coming');
    note(s, {
      at: s.minute,
      kind: 'knock',
      text: `You sent your regrets to ${h ? householdLabel(h) : 'the household'}. ${k.what === 'death' ? 'They thanked the boy who brought them, and shut the door.' : 'They were disappointed, and polite about it.'}`,
      house: k.house,
      weight: 1,
    });
    return true;
  }
  actOn(s, k.house, 'sent them away from the door');
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
    text: `You sent ${personLabel(personOf(s, k.personId) ?? { name: 'someone' }, h)} away from the door with nothing.`,
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
    if (k.what === 'wedding') {
      // The drum was heard without you: a small slight, said once, and remembered a little.
      const host = personOf(s, k.personId);
      if (host?.body.alive) adoptVoiceTrust(host, KAHYA, 0.2, 0.04);
      actOn(s, k.house, 'stayed away from the wedding');
      note(s, {
        at: k.until,
        kind: 'knock',
        text: `The drum was heard from ${houseOf(s, k.house)?.name ?? 'the lane'} all night without you.`,
        house: k.house,
        weight: 1,
      });
      continue;
    }
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
    actOn(s, k.house, 'left them waiting at the door');
    note(s, {
      at: k.until,
      kind: 'knock',
      text: `${p ? personLabel(p, houseOf(s, k.house)) : 'Someone'} waited at your door, and went back down the lane.`,
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
  actOn(s, hid, 'sent the reeve’s men for the share');
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
    text: `The local overseer’s men took ${Math.round(amt)} grain measures from ${householdLabel(h)}’s jars. The whole lane watched.`,
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
  actOn(s, hid, 'eased their share');
  for (const m of h.members) {
    const p = personOf(s, m);
    if (!p || !isAdult(p)) continue;
    adoptVoiceTrust(p, KAHYA, 0.85, 0.1);
  }
  note(s, {
    at: s.minute,
    kind: 'gift',
    text: `You reduced ${householdLabel(h)}’s share by half for this year.`,
    house: hid,
    weight: 1.5,
  });
  houseSpeaks(s, h, s.minute + 60, easeWords, 'after hearing your decision');
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
  const wed = s.notes.findLast(
    (n) =>
      n.kind === 'wedding' &&
      (n.house === h.id ||
        n.text.includes(` of ${h.name} married`) ||
        n.text.includes(` of ${householdLabel(h)} married`) ||
        n.text.includes(` from ${h.name} married`)) &&
      dayOfMinute(n.at) >= day - 20 &&
      n.at <= at,
  );
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
    ...(died ? { died: personLabel({ name: died.name }) } : {}),
    ...(left ? { left: personLabel({ name: left.name }) } : {}),
    ...(wed ? { wed: wed.house === h.id ? ('in' as const) : ('out' as const) } : {}),
    ...(needy && daysOfBread(s, needy) < 40 ? { needy: householdLabel(needy).replace(/^the /, 'The ') } : {}),
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
    text: `${residentLabel(p, h)} speaks ${where}:`,
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
  actOn(
    s,
    hid,
    why === 'wedding'
      ? 'came to the wedding'
      : why === 'birth'
        ? 'came to see the child'
        : why === 'death'
          ? 'sat with them in mourning'
          : 'sat with them',
  );
  const firstTime = ks.seen[hid] === undefined;
  const lastSeen = ks.seen[hid];
  const since = lastSeen === undefined ? undefined : (arrive - lastSeen) / DAY;
  ks.seen[hid] = arrive;
  houseSpeaks(
    s,
    h,
    arrive + 20,
    (ctx, p) => visitWords(ctx, p, firstTime, why === 'grain' ? 'call' : why, since),
    why === 'wedding' ? 'at the wedding' : 'by the fire',
  );
  // A later social visit offers room for one volunteered disclosure. Neither an imported
  // biography nor an initial greeting establishes player familiarity with a private fact.
  if (why === 'call' && since !== undefined && since >= 1) {
    const speaker = h.members
      .map((id) => personOf(s, id))
      .find(
        (p) =>
          p?.body.alive &&
          DISCLOSURES[p.id] &&
          !s.flags.beats.includes(`cast-disclosed:${p.id}`) &&
          !openAsksFor(s, p.id, arrive + 45).length,
      );
    if (speaker) {
      const facts = s.castFacts?.[speaker.id];
      if (facts?.contacts.length)
        note(s, {
          at: arrive + 40,
          kind: 'story',
          who: speaker.id,
          house: h.id,
          text: `${personLabel(speaker)} tells you about public work notes ${speaker.life.sex === 'female' ? 'she' : 'he'} read from ${facts.contacts.join(', ')}. Reading those notes does not mean ${speaker.life.sex === 'female' ? 'she' : 'he'} knows the writers.`,
          weight: 1,
        });
      s.flags.beats.push(`cast-disclosed:${speaker.id}`);
      note(s, {
        at: arrive + 45,
        kind: 'voice',
        who: speaker.id,
        house: h.id,
        text: `${personLabel(speaker, h)} speaks after sitting with you again:`,
        words: DISCLOSURES[speaker.id],
        weight: 3,
      });
    }
  }
  // What the kahya will remember of their jars: the read is as old as the visit.
  ks.guess ??= {};
  ks.guess[hid] = { at: arrive, bread: Math.round(daysOfBread(s, h)) };
  for (const m of h.members) {
    promote(s, m);
    const p = personOf(s, m);
    if (!p) continue;
    glimpsePerson(s.kahya, p, Math.max(arrive, s.kahya.now), 1);
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

/** The player can end a bounded visiting role. Capturing waits for a genuine action boundary;
 * HF refuses active projects/unsupported clinical/calendar state rather than clearing them. */
export function requestCastRelease(s: ValleyState, id: string): boolean {
  const p = personOf(s, id);
  if (!p?.body.alive || !CAST_IDS[id] || s.castReleased?.[id] || s.castReleaseRequests?.includes(id))
    return false;
  // Yusuf’s household and pregnancy have no authored care handover in this chapter.
  if (id === 'yusuf') return false;
  s.castReleaseRequests ??= [];
  s.castReleaseRequests.push(id);
  promote(s, id);
  note(s, {
    at: s.minute,
    kind: 'story',
    who: id,
    weight: 2,
    text: `${personLabel(p)} agrees to leave after the current work. ${p.life.sex === 'female' ? 'She' : 'He'} must still meet any duties and follow any health limits. The visit has not ended yet.`,
  });
  return true;
}
function roleActions(id: string): string[] {
  return (
    (
      {
        maryam: ['cook', 'store-check'],
        yusuf: ['build', 'flock-care'],
        samira: ['gather-grain', 'observe-route'],
        danyal: ['draw-water', 'store-check'],
        'yusuf-usta': ['digging-advice', 'digging-advice'],
        'meryem-visitor': ['survey', 'household-work'],
      } as Record<string, string[]>
    )[id] ?? []
  );
}
function roleLabel(action: string): string {
  return (
    (
      {
        cook: 'prepare the household meal',
        'store-check': 'check the seed and grain stores',
        build: 'work on a building repair',
        'flock-care': 'tend the household flock',
        'gather-grain': 'follow a gathering route',
        'observe-route': 'observe the local route',
        'draw-water': 'check and work the well',
        'digging-advice': 'advise on the digging line',
        survey: 'survey a bounded section',
        'household-work': 'do the agreed household work',
      } as Record<string, string>
    )[action] ?? action
  );
}

/** One spoken answer while actually sitting at a house. No trust, work, grain or RNG change.
 * The answer records the steward's words, not an agreement or a resident's private thoughts.
 */
export function replyAtHearth(s: ValleyState, hid: string): boolean {
  const v = s.kahyaState.visit;
  const h = houseOf(s, hid);
  if (!s.reply || !h?.members.length || !v || v.house !== hid || s.minute < v.arrive || s.minute >= v.leave)
    return false;
  const key = `${hid}:${v.arrive}`;
  if (s.reply.visits.includes(key)) return false;
  s.reply.visits.push(key);
  note(s, {
    at: s.minute,
    kind: 'story',
    house: hid,
    weight: 1,
    text: `You say to ${householdLabel(h)}, “I came to listen. What you said matters to me.” You have not asked for work or promised grain.`,
  });
  return true;
}
