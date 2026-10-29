/** Scope: one newly authored, backed food-for-work offer and explicitly kept outward words.
 * HF owns attention/choice/body/activity. This host owns terms, useful crop and real grain.
 * No fields or transitions exist before a valid public input; words alone activate no person.
 * 0.15/hour reuses mill pay;120 minutes/0.3/one attempt/60-minute delivery are host conventions.
 */

import { DAY, daylight, dayOfMinute, doyOf, minuteOfDay, weatherOf } from './calendar.ts';
import { PUBLIC_EDITION } from './edition.ts';
import {
  type Activity,
  type Affordance,
  abandonGoal,
  adoptGoal,
  ageYears,
  type DecisionRecord,
  lastPlace,
  type Outcome,
  type Percept,
  type Person,
  perceive,
  type Suggestion,
} from './hf.ts';
import { KAHYA, personLabel } from './people.ts';
import {
  houseOf,
  interruptHelpWorker,
  type Note,
  note,
  openAsksFor,
  personOf,
  promote,
  type ValleyState,
} from './valley.ts';

export const TERMS = {
  rate: 0.15,
  max: 0.3,
  minutes: 120,
  workEnd: 2 * DAY,
  deliveryFrom: 3 * DAY,
  deliveryDue: 5 * DAY,
  bookLimit: 64,
} as const;
export const HELP_WORDS =
  'I ask only for your own help cutting the landowner’s barley before 20 July. For each useful hour you choose to work, I will carry your household 0.15 grain measures, up to 0.3 for two hours. I set aside 0.3 now. Delivery is from 21 July until 23 July starts. If you stop early, I still owe what you earned. You may refuse. Nobody else owes work.';
const ASSENT =
  'I agree for my own work only: up to two useful hours before 20 July, at 0.15 grain measures per hour, carried here by you from 21 July until 23 July starts. I may stop early. I have not promised anyone else’s work.';
export type TermsOrder =
  | { verb: 'keep-words'; note: number }
  | { verb: 'help-offer'; person: string; house: string; ask: string; visit: number }
  | { verb: 'help-end' | 'help-deliver' | 'help-return'; contract: string };
type Choice = { at: number; offer: Affordance; record: DecisionRecord };
type Receipt = { actor: string; activity: Activity; at: number; reason: 'ended' | 'interrupted' };
export interface Help {
  id: string;
  input: number;
  at: number;
  person: string;
  house: string;
  ask: string;
  visit: { house: string; arrive: number; leave: number; back: number };
  source: Note;
  words: string;
  status: 'pending' | 'heard' | 'assenting' | 'declining' | 'agreed' | 'declined' | 'no-assent';
  hearing?: { at: number; percept: Percept; attention: Percept[] };
  choices: Choice[];
  speech?: Receipt;
  answer?: Note;
  lastPlace: string;
  stopAt?: number;
  workClosed?: string;
  work: (Receipt & { crop: number; minutes: number; earned: number })[];
  minutes: number;
  earned: number;
  held: number;
  returned: number;
  cargo: number;
  delivered: number;
  delivery?: {
    goal: string;
    phase: 'pending' | 'outbound' | 'at-house' | 'unloading' | 'returning' | 'home' | 'stranded';
    walk: number;
    out: number;
    back: number;
    returnRequested?: boolean;
    choices: Choice[];
    receipts: Receipt[];
  };
  depositedAt?: number;
  problem?: string;
}
export interface ReceivedTermsState {
  keptWords: { original: Note; copiedAt: number; input: number }[];
  help?: Help;
}
export const helpOf = (s: ValleyState) => s.receivedTerms?.help;
export const termsVerb = (verb: string) =>
  ['keep-words', 'help-offer', 'help-end', 'help-deliver', 'help-return'].includes(verb);
export function grainWords(amount: number): string {
  if (amount > 0 && amount < 0.001) return 'less than 0.001';
  return Number(amount.toFixed(3)).toString();
}
export function copyReason(s: ValleyState, id: number): string | undefined {
  if (s.edition?.id !== PUBLIC_EDITION) return 'This saved term has no kept-words action.';
  const matches = s.notes.filter((n) => n.id === id);
  if (matches.length !== 1) return 'The original note is missing or ambiguous.';
  const n = matches[0];
  if (n?.kind !== 'voice' || !n.words || !n.who || !n.house || n.at > s.minute)
    return 'Only a received, named voice note can be kept.';
  const p = personOf(s, n.who),
    gone = s.departed[n.who];
  const name = p?.name ?? gone?.name;
  if (!name || ['a household member', 'a child'].includes(name)) return 'This note has no named speaker.';
  if (s.receivedTerms?.keptWords.some((k) => k.original.id === n.id))
    return 'These words are already in the ledger.';
  if ((s.receivedTerms?.keptWords.length ?? 0) >= TERMS.bookLimit)
    return 'The kept-words book is full (64 records). No words were discarded.';
  return undefined;
}
function atHome(s: ValleyState, p: Person, h: string, at: number, help?: Help): boolean {
  const v = s.kahyaState.visit;
  return (
    !!v &&
    v.house === h &&
    at >= v.arrive &&
    at < v.leave &&
    (!s.stewardCare || lastPlace(s.kahya) === `house:${h}`) &&
    p.body.alive &&
    p.activity?.mode !== 'sleep' &&
    houseOf(s, h)?.members.includes(p.id) === true &&
    (p.activity?.affordance.placeId ?? help?.lastPlace) === `house:${h}`
  );
}
export function helpTargets(s: ValleyState): Extract<TermsOrder, { verb: 'help-offer' }>[] {
  const v = s.kahyaState.visit;
  if (
    s.edition?.id !== PUBLIC_EDITION ||
    helpOf(s) ||
    s.flags.ended ||
    !s.kahya.body.alive ||
    !v ||
    s.minute < v.arrive ||
    s.minute + 5 >= v.leave ||
    s.minute >= TERMS.workEnd ||
    s.agha.standing <= 0.5 ||
    s.agha.granary < TERMS.max
  )
    return [];
  const warning = s.notes.find(
    (n) =>
      n.kind === 'weather' &&
      n.at <= s.minute &&
      n.text === 'Clouds are building over the ridge. The old men say it will rain in two days.',
  );
  const h = houseOf(s, v.house);
  if (!warning || !h?.field.size || ['guests', 'water-guest'].includes(h.id)) return [];
  return h.members.flatMap((pid) => {
    const p = personOf(s, pid),
      asks = openAsksFor(s, pid, s.minute).filter((a) => a.job === 'reap-agha');
    const ask = asks.at(-1);
    return p &&
      ageYears(p) >= 18 &&
      atHome(s, p, h.id, s.minute) &&
      ask &&
      !asks.some((a) => a.wage || a.insisted.includes(pid))
      ? [{ verb: 'help-offer' as const, person: pid, house: h.id, ask: ask.id, visit: v.arrive }]
      : [];
  });
}
function releaseUnearned(s: ValleyState, h: Help) {
  const release = Math.max(0, TERMS.max - h.earned - h.returned);
  h.held -= release;
  h.returned += release;
  s.agha.granary += release;
}
export function applyTerms(s: ValleyState, o: TermsOrder, index: number): boolean {
  if (s.edition?.id !== PUBLIC_EDITION || !Number.isSafeInteger(index) || index < 0) return false;
  const keys =
    o.verb === 'keep-words'
      ? ['verb', 'note']
      : o.verb === 'help-offer'
        ? ['verb', 'person', 'house', 'ask', 'visit']
        : ['verb', 'contract'];
  if (Object.keys(o).some((k) => !keys.includes(k)) || Object.keys(o).length !== keys.length) return false;
  if (o.verb === 'keep-words') {
    if (!Number.isSafeInteger(o.note) || copyReason(s, o.note)) return false;
    const original = s.notes.find((n) => n.id === o.note);
    if (!original) return false;
    s.receivedTerms ??= { keptWords: [] };
    s.receivedTerms.keptWords.push({ original: structuredClone(original), copiedAt: s.minute, input: index });
    return true;
  }
  if (o.verb === 'help-offer') {
    if (
      !helpTargets(s).some(
        (t) => t.person === o.person && t.house === o.house && t.ask === o.ask && t.visit === o.visit,
      )
    )
      return false;
    const source = s.notes.find(
      (n) =>
        n.kind === 'weather' &&
        n.at <= s.minute &&
        n.text === 'Clouds are building over the ridge. The old men say it will rain in two days.',
    );
    const v = s.kahyaState.visit;
    if (!source || !v) return false;
    s.receivedTerms ??= { keptWords: [] };
    s.agha.granary -= TERMS.max;
    s.receivedTerms.help = {
      id: `help-${index}`,
      input: index,
      at: s.minute,
      person: o.person,
      house: o.house,
      ask: o.ask,
      visit: structuredClone(v),
      source: structuredClone(source),
      words: HELP_WORDS,
      status: 'pending',
      lastPlace: `house:${o.house}`,
      choices: [],
      work: [],
      minutes: 0,
      earned: 0,
      held: TERMS.max,
      returned: 0,
      cargo: 0,
      delivered: 0,
    };
    promote(s, o.person);
    note(s, {
      at: s.minute,
      kind: 'story',
      house: o.house,
      text: `You set aside 0.3 grain measures and offered ${personLabel(personOf(s, o.person) ?? { name: 'the selected person' })} these new terms. No assent or work yet.`,
      words: HELP_WORDS,
      weight: 3,
    });
    return true;
  }
  const h = helpOf(s);
  if (!h || o.contract !== h.id || s.flags.ended) return false;
  if (o.verb === 'help-end') {
    if (h.workClosed || h.stopAt !== undefined || ['declined', 'no-assent'].includes(h.status)) return false;
    const p = personOf(s, h.person);
    h.stopAt = Math.max(s.minute, p?.now ?? s.minute);
    // The existing community queue interrupts at the real reachable clock; no actor is rewound.
    if (p?.activity?.affordanceId === workId(h)) {
      interruptHelpWorker(s, h.person, h.stopAt);
    } else closeWork(s, h, 'The remaining work request ended.');
    return true;
  }
  if (o.verb === 'help-deliver') {
    if (
      s.minute < TERMS.deliveryFrom ||
      !h.workClosed ||
      h.held <= 0 ||
      h.earned <= h.delivered ||
      h.delivery ||
      !s.kahya.body.alive ||
      recipientMissing(s, h) ||
      (s.kahyaState.visit && s.kahyaState.visit.back > s.minute) ||
      (s.pass?.journey && !s.pass.journey.returned && !s.pass.journey.failed) ||
      (s.kahya.activity && !s.kahya.activity.affordanceId.startsWith('care:'))
    )
      return false;
    // The explicit public delivery request adopts the player's real route intention.
    // Use released agenda APIs and the steward's existing conscientiousness, never utility edits.
    const goal = adoptGoal(
      s.kahya,
      {
        label: 'carry the earned food and return home',
        serves: ['meaning', 'conformity'],
        advancedBy: [{ action: 'terms-walk-home', amount: 1 }],
        importance: s.kahya.traits.conscientiousness,
        deadline: TERMS.deliveryDue,
      },
      s.kahya.now,
    );
    h.delivery = {
      goal: goal.id,
      phase: 'pending',
      walk: houseOf(s, h.house)?.hamlet === 'upper' ? 75 : 20,
      out: 0,
      back: 0,
      choices: [],
      receipts: [],
    };
    return true;
  }
  if (o.verb === 'help-return') {
    const d = h.delivery;
    if (!d || ['home', 'stranded', 'pending'].includes(d.phase) || d.returnRequested) return false;
    d.returnRequested = true;
    return true;
  }
  return false;
}
const workId = (h: Help) => `terms-help-work:${h.id}`;
const speakerId = (h: Help, yes: boolean) => `terms-help-${yes ? 'assent' : 'decline'}:${h.id}`;
export function termsHear(s: ValleyState) {
  const h = helpOf(s),
    p = h && personOf(s, h.person);
  if (!h || !p || h.status !== 'pending' || p.now < h.at || !atHome(s, p, h.house, p.now, h)) return;
  const percept: Percept = {
    at: p.now,
    channel: 'social',
    kind: 'speech',
    actorId: KAHYA,
    targetId: p.id,
    salience: 0.7,
    valence: 0,
    summary: h.words,
  };
  const attention = perceive(p, [percept]);
  h.hearing = { at: p.now, percept, attention: structuredClone(attention) };
  h.status = attention.length ? 'heard' : 'no-assent';
  if (!attention.length) closeWork(s, h, 'The proposal was not attended. No assent.');
}
export function termsOffers(s: ValleyState, p: Person, at: number): Affordance[] {
  const h = helpOf(s);
  if (!h || h.person !== p.id || h.workClosed || s.flags.ended) return [];
  if (
    h.status === 'heard' &&
    h.hearing?.attention.length &&
    at + 5 < h.visit.leave &&
    atHome(s, p, h.house, at, h)
  )
    return [true, false].map((yes) => ({
      id: speakerId(h, yes),
      action: yes ? 'terms-help-assent' : 'terms-help-decline',
      label: yes ? 'agree to the specific food and work terms' : 'decline the food and work terms',
      duration: 5,
      placeId: `house:${h.house}`,
      effort: 0.05,
      advertises: { belonging: 0.12, leisure: 0.06 },
      tags: ['social'],
    }));
  if (
    h.status !== 'agreed' ||
    h.stopAt !== undefined ||
    at >= TERMS.workEnd ||
    !p.body.alive ||
    recipientMissing(s, h)
  )
    return [];
  const { rise, set } = daylight(doyOf(dayOfMinute(at)));
  const sky = weatherOf(s.seed, dayOfMinute(at)).sky;
  const duration = Math.min(120 - h.minutes, TERMS.workEnd - at);
  if (
    duration <= 0 ||
    minuteOfDay(at) < rise ||
    minuteOfDay(at) >= set - 30 ||
    ['storm', 'snow'].includes(sky) ||
    s.agha.standing <= 0.5
  )
    return [];
  return [
    {
      id: workId(h),
      action: 'reap-agha',
      label: 'cut barley under the agreed food terms',
      placeId: 'field:agha',
      duration,
      effort: 0.7,
      skill: { id: 'farming', difficulty: 0.3 },
      advertises: { esteem: 0.03 },
      material: Math.min(TERMS.max - h.earned, (duration / 60) * TERMS.rate),
      tags: ['work', 'outdoors'],
    },
  ];
}
export function termsSuggestion(s: ValleyState, p: Person, at: number): Suggestion | undefined {
  const h = helpOf(s);
  if (!h || h.person !== p.id || h.workClosed || at >= TERMS.workEnd) return undefined;
  return {
    voiceId: KAHYA,
    action: h.status === 'agreed' ? 'reap-agha' : 'terms-help-assent',
    strength: 0.45,
    appeal: 'duty',
    since: h.at,
  };
}
export function termsCapture(s: ValleyState, p: Person, offer: Affordance, record: DecisionRecord): boolean {
  const h = helpOf(s);
  if (!h || h.person !== p.id || h.workClosed) return false;
  h.lastPlace = offer.placeId ?? h.lastPlace;
  h.choices.push({ at: p.now, offer: structuredClone(offer), record: structuredClone(record) });
  if (offer.id === speakerId(h, true)) h.status = 'assenting';
  if (offer.id === speakerId(h, false)) h.status = 'declining';
  return offer.id.startsWith('terms-help-');
}
function matches(h: Help, a: Activity) {
  return h.choices.some((c) => c.record.id === a.decisionId && c.offer.id === a.affordanceId);
}
export function resolveTermsSpeech(
  s: ValleyState,
  p: Person,
  a: Activity,
  reason: 'ended' | 'interrupted',
): Outcome | undefined {
  if (!a.affordanceId.startsWith('terms-help-assent:') && !a.affordanceId.startsWith('terms-help-decline:'))
    return undefined;
  const out: Outcome = { action: a.action, affordanceId: a.affordanceId, status: 'interrupted', at: p.now };
  const h = helpOf(s);
  if (!h || h.person !== p.id || h.speech || !matches(h, a)) return out;
  h.speech = { actor: p.id, activity: structuredClone(a), at: p.now, reason };
  const valid =
    reason === 'ended' &&
    p.now >= a.endsAt &&
    a.endsAt - a.startedAt >= 5 &&
    p.now < h.visit.leave &&
    h.hearing?.attention.length &&
    a.startedAt >= h.hearing.at &&
    atHome(s, p, h.house, p.now, h) &&
    !h.workClosed;
  if (valid) {
    const yes = a.affordanceId === speakerId(h, true);
    h.status = yes ? 'agreed' : 'declined';
    note(s, {
      at: p.now,
      kind: 'voice',
      who: p.id,
      house: h.house,
      weight: 3,
      text: `${personLabel(p)} answers the offered terms:`,
      words: yes ? ASSENT : 'I do not agree to those terms.',
    });
    h.answer = structuredClone(s.notes.at(-1));
    out.status = 'completed';
    if (!yes) closeWork(s, h, 'The terms were declined.');
  } else {
    h.status = 'no-assent';
    closeWork(s, h, 'The assent did not complete.');
  }
  return out;
}
export function helpWork(s: ValleyState, p: Person, a: Activity): Help | undefined {
  const h = helpOf(s);
  return h && h.person === p.id && a.affordanceId === workId(h) ? h : undefined;
}
export function workSeen(h: Help, a: Activity): boolean {
  return h.work.some((w) => w.activity.decisionId === a.decisionId && w.activity.startedAt === a.startedAt);
}
export function workHours(h: Help, a: Activity, at: number): number {
  if (h.status !== 'agreed' || h.workClosed || !matches(h, a)) return 0;
  return Math.max(0, Math.min(at, a.endsAt, TERMS.workEnd, h.stopAt ?? Infinity) - a.startedAt) / 60;
}
export function recordHelpWork(
  s: ValleyState,
  h: Help,
  p: Person,
  a: Activity,
  reason: 'ended' | 'interrupted',
  potential: number,
  crop: number,
  hours: number,
) {
  const minutes = Math.min(TERMS.minutes - h.minutes, potential > 0 ? (hours * 60 * crop) / potential : 0);
  const earned = (minutes / 60) * TERMS.rate;
  h.minutes += minutes;
  h.earned += earned;
  h.work.push({ actor: p.id, activity: structuredClone(a), at: p.now, reason, crop, minutes, earned });
  if (
    h.minutes >= TERMS.minutes - 1e-9 ||
    p.now >= TERMS.workEnd ||
    h.stopAt !== undefined ||
    s.agha.standing <= 0.5
  )
    closeWork(
      s,
      h,
      h.stopAt !== undefined ? 'Remaining work ended.' : 'The work window or useful work ended.',
    );
}
function closeWork(s: ValleyState, h: Help, why: string) {
  if (h.workClosed) return;
  h.workClosed = why;
  if (h.status !== 'agreed' && !['declined', 'no-assent'].includes(h.status)) h.status = 'no-assent';
  releaseUnearned(s, h);
}
const recipientMissing = (s: ValleyState, h: Help) =>
  !personOf(s, h.person)?.body.alive || !houseOf(s, h.house)?.members.includes(h.person);
export function termsTick(s: ValleyState, at = s.minute) {
  const h = helpOf(s);
  if (!h) return;
  const p = personOf(s, h.person);
  const working = p?.activity?.affordanceId === workId(h);
  if (!h.workClosed && recipientMissing(s, h)) closeWork(s, h, 'The signatory is no longer available.');
  if (
    !h.workClosed &&
    !working &&
    (s.flags.ended ||
      recipientMissing(s, h) ||
      at >= TERMS.workEnd ||
      (h.status !== 'agreed' && at >= h.visit.leave))
  )
    closeWork(s, h, 'The proposal or work window ended.');
  if (recipientMissing(s, h))
    h.problem = 'The agreed recipient is no longer available. Earned grain is not delivered.';
  if (!s.kahya.body.alive && deliveryAway(s)) {
    if (h.delivery) h.delivery.phase = 'stranded';
    h.problem = 'The steward died away. The cargo is stranded and unpaid.';
  }
}
export function termsBoundary(s: ValleyState, to: number): number {
  const h = helpOf(s);
  if (!h) return to;
  const times = [TERMS.workEnd, TERMS.deliveryFrom, TERMS.deliveryDue, h.visit.leave];
  return Math.min(to, ...times.filter((at) => at > s.minute));
}
export function activeHelpFor(s: ValleyState, pid: string): boolean {
  const h = helpOf(s);
  return !!h && h.person === pid && !h.workClosed;
}
/** A requested delivery owns the route even while the steward is still caring at home. */
export function deliveryTripReserved(s: ValleyState): boolean {
  const d = helpOf(s)?.delivery;
  return !!d && d.phase !== 'home';
}
export function deliveryAway(s: ValleyState): boolean {
  const d = helpOf(s)?.delivery;
  return !!d && !['pending', 'home'].includes(d.phase);
}
export function deliveryLive(s: ValleyState): boolean {
  const d = helpOf(s)?.delivery;
  return !!d && !['home', 'stranded'].includes(d.phase);
}
export function termsStewardPlace(s: ValleyState): string {
  const h = helpOf(s),
    d = h?.delivery;
  return h && d && ['at-house', 'unloading'].includes(d.phase)
    ? `house:${h.house}`
    : deliveryAway(s)
      ? 'lane'
      : 'residence';
}
export function termsStewardOffers(s: ValleyState, at: number): Affordance[] {
  const h = helpOf(s),
    d = h?.delivery;
  if (!h || !d || !deliveryLive(s) || s.flags.ended || !s.kahya.body.alive) return [];
  if (d.phase === 'pending') {
    if (recipientMissing(s, h)) return [];
    return [legOffer(h, 'outbound', d.walk - d.out)];
  }
  if (d.phase === 'outbound') return [legOffer(h, 'outbound', d.walk - d.out)];
  if (d.phase === 'returning') return [legOffer(h, 'returning', Math.max(0, d.out - d.back))];
  if (d.returnRequested || recipientMissing(s, h) || h.delivered >= h.earned)
    return [legOffer(h, 'returning', d.out - d.back)];
  return [
    {
      id: `terms-delivery:unload:${h.id}`,
      action: 'terms-carry-food',
      advances: [d.goal],
      label: 'carry and put down the earned grain',
      placeId: `house:${h.house}`,
      duration: 60,
      effort: 0.2,
      advertises: { competence: 0.03 },
      tags: ['work'],
    },
  ].filter((a) => at >= TERMS.deliveryFrom && a.duration > 0);
}
function legOffer(h: Help, leg: string, duration: number): Affordance {
  return {
    id: `terms-delivery:${leg}:${h.id}`,
    action: leg === 'returning' ? 'terms-walk-home' : 'walk',
    advances: h.delivery ? [h.delivery.goal] : [],
    label: leg === 'outbound' ? 'carry the earned food along the lane' : 'walk back to the residence',
    placeId: 'lane',
    duration: Math.max(1, duration),
    effort: h.delivery?.walk === 75 ? 0.55 : 0.3,
    advertises: { competence: 0.03 },
    tags: ['work', 'outdoors'],
  };
}
export function captureTermsSteward(s: ValleyState, offer: Affordance, record: DecisionRecord) {
  const h = helpOf(s),
    d = h?.delivery;
  if (!h || !d || !deliveryLive(s)) return;
  d.choices.push({ at: s.kahya.now, offer: structuredClone(offer), record: structuredClone(record) });
  if (!offer.id.startsWith('terms-delivery:')) return;
  if (d.phase === 'pending') {
    h.cargo = h.held;
    h.held = 0;
    d.phase = 'outbound';
  }
  if (offer.id.includes(':unload:')) d.phase = 'unloading';
  if (offer.id.includes(':returning:')) d.phase = 'returning';
}
export function resolveTermsSteward(
  s: ValleyState,
  a: Activity,
  reason: 'ended' | 'interrupted',
): Outcome | undefined {
  if (!a.affordanceId.startsWith('terms-delivery:')) return undefined;
  const h = helpOf(s),
    d = h?.delivery,
    p = s.kahya;
  const out: Outcome = {
    action: a.action,
    affordanceId: a.affordanceId,
    at: p.now,
    status: reason === 'ended' ? 'completed' : 'interrupted',
  };
  if (
    !h ||
    !d ||
    d.receipts.some((r) => r.activity.decisionId === a.decisionId) ||
    !d.choices.some((c) => c.record.id === a.decisionId && c.offer.id === a.affordanceId)
  )
    return out;
  d.receipts.push({ actor: p.id, activity: structuredClone(a), at: p.now, reason });
  const elapsed = Math.max(0, Math.min(p.now, a.endsAt) - a.startedAt);
  if (a.affordanceId.includes(':outbound:')) {
    d.out = Math.min(d.walk, d.out + elapsed);
    if (d.out >= d.walk) d.phase = 'at-house';
  } else if (a.affordanceId.includes(':returning:')) {
    d.back = Math.min(d.out, d.back + elapsed);
    if (d.back >= d.out) {
      h.held += h.cargo;
      h.cargo = 0;
      d.phase = 'home';
      if (h.delivered < h.earned) abandonGoal(p, d.goal);
    }
  } else {
    d.phase = 'at-house';
    if (reason === 'ended') out.status = 'failed';
    if (
      reason === 'ended' &&
      p.now >= a.endsAt &&
      elapsed >= 60 &&
      !d.returnRequested &&
      !s.flags.ended &&
      p.body.alive &&
      !recipientMissing(s, h) &&
      p.now >= TERMS.deliveryFrom
    ) {
      const house = houseOf(s, h.house);
      if (house) {
        out.status = 'completed';
        house.store += h.cargo;
        h.delivered += h.cargo;
        out.material = -h.cargo;
        h.cargo = 0;
        h.depositedAt = p.now;
        d.returnRequested = true;
      }
    }
  }
  return out;
}

/** Structural bounds only. load() still regenerates every accepted input and native value. */
export function validateTermsState(s: ValleyState) {
  const t = s.receivedTerms;
  if (t === undefined) return;
  if (
    s.edition?.id !== PUBLIC_EDITION ||
    !t ||
    typeof t !== 'object' ||
    Array.isArray(t) ||
    Object.keys(t).some((k) => !['keptWords', 'help'].includes(k)) ||
    !Array.isArray(t.keptWords) ||
    t.keptWords.length > 64
  )
    throw new Error('Invalid received terms state.');
  const ids = new Set<number>();
  for (const k of t.keptWords) {
    if (
      !k ||
      Object.keys(k).some((x) => !['original', 'copiedAt', 'input'].includes(x)) ||
      !k.original ||
      !Number.isSafeInteger(k.original.id) ||
      ids.has(k.original.id) ||
      k.original.kind !== 'voice' ||
      !k.original.words ||
      !k.original.who ||
      !k.original.house ||
      k.original.at > k.copiedAt ||
      k.copiedAt > s.minute ||
      !Number.isSafeInteger(k.input) ||
      k.input < 0
    )
      throw new Error('Invalid kept words.');
    ids.add(k.original.id);
  }
}
