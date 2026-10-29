/** Valley owns this closed Zehra scene and its authored words. HF owns attention,
 * voluntary choice, the body and timed activity. No free-text understanding or bargain is claimed. */

import { DAY, dateEnglish, dayOfMinute, yearOf } from './calendar.ts';
import { DIALOGUE_EDITION, PUBLIC_EDITION } from './edition.ts';
import {
  type Activity,
  type Affordance,
  type DecisionRecord,
  lastPlace,
  type Outcome,
  type Percept,
  type Person,
  perceive,
  type SimEvent,
} from './hf.ts';
import { KAHYA, personLabel } from './people.ts';
import {
  houseOf,
  type Note,
  note,
  openAsksFor,
  personOf,
  promote,
  type Reply,
  type ValleyState,
} from './valley.ts';

export type ContextLine = 'birth' | 'son' | 'friendship' | 'reciprocal-help';
export type DialogueLine = 'follow-up' | 'work-need' | 'after-cut' | ContextLine;
/** Scope: four finite authored visit questions. A Note keeps its original id/time and
 * complete bytes; a public house description has no recorded original date. The
 * request time is prospective. No new physical reason, trust, promise, resource or
 * cooperation follows from this scene. HF still owns hearing and competing choices. */
export interface ContextRequest {
  kind: 'valley-context-request/1';
  input: number;
  at: number;
  source: { kind: 'note'; note: Note } | { kind: 'house-description'; house: string; text: string };
}
const CONTEXT_PEOPLE = { birth: 'yusuf', son: 'serife', friendship: 'danyal', 'reciprocal-help': 'zehra' };
function contextual(line: DialogueLine): line is ContextLine {
  return Object.hasOwn(CONTEXT_PEOPLE, line);
}
function contextSource(s: ValleyState, line: ContextLine): ContextRequest['source'] | undefined {
  const v = s.kahyaState.visit;
  if (!v || s.edition?.id !== PUBLIC_EDITION) return undefined;
  const h = houseOf(s, v.house);
  const p = personOf(s, CONTEXT_PEOPLE[line]);
  if (!h || !p || !present(s, p, h.id)) return undefined;
  if (line === 'birth') {
    if (h.id !== 'coban' || !h.members.includes('zehra')) return undefined;
    const source = s.notes.findLast(
      (n) => n.kind === 'birth' && n.house === h.id && n.who === 'zehra' && n.at <= s.minute,
    );
    // A completed host birth receipt names both actual parents. A public note alone does not.
    const child = s.people.find(
      (c) => s.births?.[c.id]?.mother === 'zehra' && s.births[c.id]?.father === p.id,
    );
    return source && child ? { kind: 'note', note: source } : undefined;
  }
  if (line === 'reciprocal-help') {
    if (s.minute >= 2 * DAY || !openAsksFor(s, p.id, s.minute).some((a) => a.job === 'reap-agha'))
      return undefined;
    if (
      !s.notes.some(
        (n) =>
          n.kind === 'weather' &&
          n.at <= s.minute &&
          n.text === 'Clouds are building over the ridge. The old men say it will rain in two days.',
      )
    )
      return undefined;
    const source = s.notes.findLast(
      (n) =>
        n.who === p.id &&
        n.house === h.id &&
        n.at <= s.minute &&
        ['reply', 'voice'].includes(n.kind) &&
        n.words === FOOD_QUESTION,
    );
    return source ? { kind: 'note', note: source } : undefined;
  }
  if (line === 'friendship') {
    if (
      h.id !== 'water-guest' ||
      !h.looks.includes('He and Maryam are old friends.') ||
      !p.social.relationships.some((r) => r.otherId === 'maryam' && r.roles.includes('friend'))
    )
      return undefined;
  } else {
    // Do not assign the description's coffeehouse behaviour to a newly named son.
    if (
      h.id !== 'tepe' ||
      h.looks !==
        'This house is up the slope. The son spends more time at the coffeehouse than working in the fields.' ||
      !p.social.relationships.some(
        (r) =>
          r.roles.includes('child') &&
          h.members.includes(r.otherId) &&
          personOf(s, r.otherId)?.life.sex === 'male',
      )
    )
      return undefined;
  }
  return { kind: 'house-description', house: h.id, text: h.looks };
}

/** Scope: one current question about an actual outward food/work concern after cutting.
 * This is a prospective request anchor, never an old completion timestamp. Full native
 * admission regenerates it at this input against the complete deterministic world.
 * It grants no food, work, debt, permission or trust; HF may withhold or interrupt. */
export interface CutRequest {
  kind: 'valley-cut-request/1';
  input: number;
  at: number;
  beat: string;
  standing: number;
  reaped: number;
  source: Note;
}
const FOOD_QUESTION = 'Who will feed my family while I cut his barley?';
const cutBeat = (s: ValleyState) => `cut-${yearOf(dayOfMinute(s.minute))}`;
function cutSource(s: ValleyState, house: string): Note | undefined {
  if (s.agha.standing > 0.5 || !s.flags.beats.includes(cutBeat(s))) return undefined;
  if (s.dialogue?.exchanges.some((e) => e.cut?.beat === cutBeat(s))) return undefined;
  return s.notes.findLast(
    (n) =>
      n.who === 'zehra' &&
      n.house === house &&
      n.at <= s.minute &&
      (n.kind === 'reply' || n.kind === 'voice') &&
      n.words === FOOD_QUESTION,
  );
}
export interface DialogueOrder {
  verb: 'dialogue';
  turn: number;
  house: string;
  person: string;
  visit: number;
  prior: number;
  line: DialogueLine;
  ask?: string;
}
export interface Exchange {
  turn: number;
  house: string;
  person: string;
  visit: number;
  leave: number;
  prior: { id: number; at: number; words: string; ask?: string };
  line: DialogueLine;
  ask?: string;
  existingWork?: Reply;
  cut?: CutRequest;
  context?: ContextRequest;
  saidAt: number;
  words: string;
  speechNote: number;
  status:
    | 'pending'
    | 'heard'
    | 'talking'
    | 'withheld'
    | 'completed'
    | 'interrupted'
    | 'expired'
    | 'cancelled';
  hearing?: { deliveredAt: number; percept: Percept; attended: Percept[]; memoryTimes: number[] };
  decisions: { at: number; record: DecisionRecord; offer: Affordance }[];
  activity?: Activity;
  endedAt?: number;
  answerNote?: number;
  answer?: { at: number; words: string };
  events: SimEvent[];
  work?: { reply: Reply; observedAt: number; activity?: Activity; hours: number };
}
export interface DialogueState {
  id: typeof DIALOGUE_EDITION;
  exchanges: Exchange[];
  place?: string;
}
const active = (e: Exchange) => ['pending', 'heard', 'talking'].includes(e.status);
const current = (s: ValleyState) => s.dialogue?.exchanges.findLast(active);
function present(s: ValleyState, p: Person, house: string): boolean {
  const exchange = current(s);
  // HF clears a completed activity before requesting the next offers. This
  // accepted contextual visit already proved this actor was at this house.
  // Retain that location until an actual chosen activity supplies its next place.
  // Zehra's older bookkeeping and all no-context continuations remain literal.
  const contextPlace =
    exchange?.context && exchange.person === p.id
      ? (exchange.decisions.at(-1)?.offer.placeId ?? `house:${exchange.house}`)
      : undefined;
  const location = p.activity?.affordance.placeId ?? (p.id === 'zehra' ? s.dialogue?.place : contextPlace);
  return (
    !!p.body.alive &&
    p.activity?.mode !== 'sleep' &&
    !!houseOf(s, house)?.members.includes(p.id) &&
    location === `house:${house}`
  );
}
function attended(s: ValleyState, house: string, visit: number, at: number): boolean {
  const v = s.kahyaState.visit;
  return (
    !!v &&
    v.house === house &&
    v.arrive === visit &&
    v.arrive <= at &&
    at < v.leave &&
    (!s.stewardCare || lastPlace(s.kahya) === `house:${house}`)
  );
}
function zehraChoices(s: ValleyState): DialogueOrder[] {
  const v = s.kahyaState.visit,
    p = personOf(s, 'zehra');
  if (
    !s.dialogue ||
    !v ||
    !p ||
    current(s) ||
    !attended(s, v.house, v.arrive, s.minute) ||
    v.leave - s.minute < 5 ||
    !present(s, p, v.house)
  )
    return [];
  // Use the registry id and actual household membership, never name equality.
  const prior = s.notes.findLast(
    (n) =>
      n.who === p.id &&
      n.house === v.house &&
      n.at <= s.minute &&
      (n.kind === 'reply' || n.kind === 'voice') &&
      !!n.words &&
      !s.dialogue?.exchanges.some((e) => e.answerNote === n.id),
  );
  if (!prior) return [];
  const base = {
    verb: 'dialogue' as const,
    turn: s.dialogue.exchanges.length,
    house: v.house,
    person: p.id,
    visit: v.arrive,
    prior: prior.id,
  };
  const choices: DialogueOrder[] = [{ ...base, line: 'follow-up' }];
  const ask = openAsksFor(s, p.id, s.minute).findLast((a) => a.job === 'reap-agha');
  // The only dated public forecast is the opening two-day warning. Do not simulate ahead.
  if (
    ask &&
    s.minute < 2 * DAY &&
    s.notes.some(
      (n) =>
        n.kind === 'weather' &&
        n.at <= s.minute &&
        n.text === 'Clouds are building over the ridge. The old men say it will rain in two days.',
    )
  )
    choices.push({ ...base, line: 'work-need', ask: ask.id });
  const source = cutSource(s, v.house);
  if (source) choices.push({ ...base, prior: source.id, line: 'after-cut' });
  return choices;
}
export function dialogueChoices(s: ValleyState): DialogueOrder[] {
  const choices = zehraChoices(s);
  const v = s.kahyaState.visit;
  if (
    !s.dialogue ||
    !v ||
    current(s) ||
    s.flags.ended ||
    !s.kahya.body.alive ||
    !attended(s, v.house, v.arrive, s.minute) ||
    v.leave - s.minute < 5
  )
    return choices;
  for (const line of Object.keys(CONTEXT_PEOPLE) as ContextLine[]) {
    const source = contextSource(s, line);
    if (
      !source ||
      s.dialogue.exchanges.some((e) => e.visit === v.arrive && e.house === v.house && e.line === line)
    )
      continue;
    choices.push({
      verb: 'dialogue',
      turn: s.dialogue.exchanges.length,
      house: v.house,
      person: CONTEXT_PEOPLE[line],
      visit: v.arrive,
      prior: source.kind === 'note' ? source.note.id : 0,
      line,
    });
  }
  return choices;
}
export function dialogueWords(s: ValleyState, o: DialogueOrder): string {
  const prior = s.notes.find((n) => n.id === o.prior);
  if (o.line === 'birth')
    return `The birth notice says, “${prior?.text ?? ''}” Yusuf, what would you like me to understand before I ask for work?`;
  if (o.line === 'friendship')
    return 'Danyal, you and Maryam are old friends. May I ask about that friendship?';
  if (o.line === 'son')
    return 'About your son and the coffeehouse: What would you like me to understand before I ask for field work?';
  if (o.line === 'reciprocal-help')
    return `You asked, “${prior?.words ?? ''}” Could we discuss help before the rain and help afterwards, without agreeing to either yet?`;
  if (o.line === 'after-cut')
    return `The landowner’s barley is cut now. You asked, “${prior?.words ?? ''}” What did you want me to understand about your family’s food?`;
  return o.line === 'follow-up'
    ? `You said, “${prior?.words ?? ''}” What would you like me to know about that?`
    : `Rain is due on ${dateEnglish(2)}. I need hands to cut the landowner’s barley. Can you help before then?`;
}
export function speakDialogue(s: ValleyState, o: DialogueOrder, inputIndex: number): boolean {
  if (
    Object.keys(o).some(
      (k) => !['verb', 'turn', 'house', 'person', 'visit', 'prior', 'line', 'ask'].includes(k),
    )
  )
    return false;
  const choice = dialogueChoices(s).find(
    (c) =>
      c.turn === o.turn &&
      c.house === o.house &&
      c.person === o.person &&
      c.visit === o.visit &&
      c.prior === o.prior &&
      c.line === o.line &&
      c.ask === o.ask,
  );
  if (
    !choice ||
    ((o.line === 'after-cut' || contextual(o.line)) && (!Number.isSafeInteger(inputIndex) || inputIndex < 0))
  )
    return false;
  const source = contextual(o.line) ? contextSource(s, o.line) : undefined;
  const prior =
    source?.kind === 'house-description'
      ? { id: 0, at: s.minute, words: source.text }
      : s.notes.find((n) => n.id === o.prior);
  const v = s.kahyaState.visit;
  const priorWords = source?.kind === 'note' ? (source.note.words ?? source.note.text) : prior?.words;
  if (!prior || !priorWords || !v || !s.dialogue) return false;
  const words = dialogueWords(s, o);
  const ask = s.asks.find((a) => a.id === o.ask);
  const e: Exchange = {
    turn: o.turn,
    house: o.house,
    person: o.person,
    visit: o.visit,
    leave: v.leave,
    prior: {
      id: prior.id,
      at: prior.at,
      words: priorWords,
      ...('ask' in prior && prior.ask ? { ask: prior.ask } : {}),
    },
    line: o.line,
    ...(o.line === 'after-cut'
      ? {
          cut: {
            kind: 'valley-cut-request/1' as const,
            input: inputIndex,
            at: s.minute,
            beat: cutBeat(s),
            standing: s.agha.standing,
            reaped: s.agha.reaped,
            source: structuredClone(prior as Note),
          },
        }
      : {}),
    ...(source
      ? {
          context: {
            kind: 'valley-context-request/1' as const,
            input: inputIndex,
            at: s.minute,
            source: structuredClone(source),
          },
        }
      : {}),
    ...(o.ask ? { ask: o.ask } : {}),
    ...(ask?.replies[o.person] ? { existingWork: structuredClone(ask.replies[o.person]) } : {}),
    saidAt: s.minute,
    words,
    speechNote: s.nextNote,
    status: 'pending',
    decisions: [],
    events: [],
  };
  s.dialogue.exchanges.push(e);
  note(s, {
    at: s.minute,
    kind: 'story',
    house: o.house,
    who: KAHYA,
    text: `You say to ${personLabel(personOf(s, o.person) ?? { name: 'someone' }, houseOf(s, o.house))}, “${words}” No answer yet.`,
    weight: 2,
  });
  promote(s, o.person);
  return true;
}
export function cancelDialogue(s: ValleyState, turn: number): boolean {
  const e = current(s);
  if (!e || e.turn !== turn) return false;
  e.status = 'cancelled';
  e.endedAt = s.minute;
  note(s, {
    at: s.minute,
    kind: 'story',
    house: e.house,
    text: 'You end this question. Time already spent remains spent. There is no completed answer.',
    weight: 1,
  });
  return true;
}
/** Called only AFTER ordinary resident catch-up. Never backdate a percept or write a Person clock. */
export function dialogueHear(s: ValleyState): void {
  const e = current(s);
  if (e?.status !== 'pending') return;
  const p = personOf(s, e.person);
  if (!p || p.now < e.saidAt) return;
  if (!attended(s, e.house, e.visit, p.now) || !present(s, p, e.house)) {
    e.status = 'expired';
    e.endedAt = p.now;
    return;
  }
  const percept: Percept = {
    at: p.now,
    channel: 'heard',
    kind: `valley-dialogue:${e.turn}`,
    actorId: KAHYA,
    targetId: p.id,
    placeId: `house:${e.house}`,
    salience: 0.5,
    valence: 0,
    near: false,
    summary: e.words,
  };
  const heard = perceive(p, [percept]);
  e.hearing = {
    deliveredAt: p.now,
    percept,
    attended: structuredClone(heard),
    memoryTimes: p.memory.episodes.filter((m) => m.summary === e.words).map((m) => m.at),
  };
  e.status = heard.length ? 'heard' : 'withheld';
  if (!heard.length) e.endedAt = p.now;
  note(s, {
    at: p.now,
    kind: 'story',
    house: e.house,
    text: `Your question reached ${personLabel(p, houseOf(s, e.house))}. Hearing is separate from choosing to speak. No answer yet.`,
    weight: 1,
  });
}
export function dialogueOffers(s: ValleyState, p: Person, at: number): Affordance[] {
  const e = current(s);
  if (
    !e ||
    e.person !== p.id ||
    e.status !== 'heard' ||
    !e.hearing ||
    at < e.hearing.deliveredAt ||
    at + 5 > e.leave ||
    !attended(s, e.house, e.visit, at) ||
    !present(s, p, e.house)
  )
    return [];
  return [
    {
      id: `valley-dialogue:${e.turn}`,
      action: 'valley-hearth-talk',
      label: 'sit and answer the steward’s question',
      placeId: `house:${e.house}`,
      duration: 5,
      effort: e.cut ? 0 : 0.05, // This new exchange is seated; old offers remain literal.
      advertises: { belonging: 0.12, leisure: 0.06 },
      tags: ['social'],
    },
  ];
}
export function captureDialogue(s: ValleyState, p: Person, offer: Affordance, record: DecisionRecord): void {
  if (!s.dialogue) return;
  if (p.id === 'zehra') s.dialogue.place = offer.placeId;
  const e = current(s);
  if (!e || e.person !== p.id || !e.hearing || p.now < e.hearing.deliveredAt) return;
  e.decisions.push({ at: p.now, record: structuredClone(record), offer: structuredClone(offer) });
  if (offer.id === `valley-dialogue:${e.turn}`) {
    e.status = 'talking';
    note(s, {
      at: p.now,
      kind: 'story',
      house: e.house,
      who: p.id,
      text: `${personLabel(p, houseOf(s, e.house))} sits to speak with you. The talk has not finished.`,
      weight: 2,
    });
  } else if (e.status === 'heard') {
    e.status = 'withheld';
    e.endedAt = p.now;
    note(s, {
      at: p.now,
      kind: 'story',
      house: e.house,
      text: `${personLabel(p, houseOf(s, e.house))} has not chosen to answer this question. You may ask again while the visit permits.`,
      weight: 2,
    });
  }
}
export function resolveDialogue(
  s: ValleyState,
  p: Person,
  a: Activity,
  reason: 'ended' | 'interrupted',
): Outcome | undefined {
  if (a.action !== 'valley-hearth-talk') return undefined;
  const e = s.dialogue?.exchanges.find(
    (x) => a.affordanceId === `valley-dialogue:${x.turn}` && x.person === p.id,
  );
  const completed =
    !!e &&
    e.status === 'talking' &&
    reason === 'ended' &&
    p.now >= a.endsAt &&
    p.now - a.startedAt >= 5 &&
    p.now < e.leave &&
    !!e.hearing &&
    a.startedAt >= e.hearing.deliveredAt &&
    e.decisions.some((d) => d.record.id === a.decisionId && d.offer.id === a.affordanceId) &&
    attended(s, e.house, e.visit, p.now) &&
    present(s, p, e.house);
  if (e) {
    e.activity = structuredClone(a);
    e.endedAt = p.now;
    if (completed) {
      e.status = 'completed';
      e.answerNote = s.nextNote;
      note(s, {
        at: p.now,
        kind: 'voice',
        house: e.house,
        who: p.id,
        text: `${personLabel(p, houseOf(s, e.house))} answers your question after sitting with you:`,
        words:
          e.line === 'birth'
            ? 'You came about the child. Keep this visit separate from the landowner’s work. Sitting with you is not agreeing to leave my household.'
            : e.line === 'friendship'
              ? 'Maryam is my old friend. I do not speak for her. Ask her what she wants you to know.'
              : e.line === 'son'
                ? 'I have not told you why he is there. If you want field work, ask for it separately. This visit is not an agreement to send anyone.'
                : e.line === 'reciprocal-help'
                  ? 'You are asking for help now and talking of help later. What help, and when? We have agreed to neither. My answer to the field call is separate.'
                  : e.line === 'after-cut'
                    ? 'His barley is cut now. I was asking how my family would eat if I went to his field. Finishing his field does not answer that question. Sitting here with you is not a promise to work for you.'
                    : e.line === 'follow-up'
                      ? `When I said “${e.prior.words}”, that is what I wanted you to hear. I have given this time to answer you. It is not a promise to leave my work.`
                      : `I heard why you need hands before the rain. It is not a promise to leave my work. You have heard my answer about talking. My answer to the work request is separate.`,
        weight: 3,
      });
      const answer = s.notes.find((n) => n.id === e.answerNote);
      if (answer?.words) e.answer = { at: answer.at, words: answer.words };
    } else if (e.status !== 'cancelled') {
      e.status = 'interrupted';
    }
  }
  return {
    affordanceId: a.affordanceId,
    action: a.action,
    at: p.now,
    status: completed ? 'completed' : 'interrupted',
  };
}
export function dialogueTick(s: ValleyState, to: number, events: SimEvent[]): void {
  for (const e of s.dialogue?.exchanges ?? []) {
    if (active(e) || e.endedAt === undefined || e.endedAt > s.minute)
      e.events.push(
        ...structuredClone(events.filter((event) => event.personId === e.person && event.at >= e.saidAt)),
      );
    const p = personOf(s, e.person);
    if (e.status === 'talking' && p?.activity?.affordanceId === `valley-dialogue:${e.turn}`)
      e.activity = structuredClone(p.activity);
    if (active(e) && (to >= e.leave || !p?.body.alive || !attended(s, e.house, e.visit, to))) {
      e.status = 'expired';
      e.endedAt = to;
    }
    if (e.ask) {
      const ask = s.asks.find((a) => a.id === e.ask),
        r = ask?.replies[e.person];
      if (r && r.at > e.saidAt)
        e.work = {
          reply: structuredClone(r),
          observedAt: to,
          ...(p?.activity?.action === ask?.job ? { activity: structuredClone(p.activity) } : {}),
          hours: ask?.hours[e.person] ?? 0,
        };
    }
  }
}
export function dialogueStatus(e: Exchange): string {
  const state =
    e.status === 'completed'
      ? 'The talk finished.'
      : e.status === 'talking'
        ? 'Zehra is sitting to speak. No completed answer yet.'
        : e.status === 'withheld'
          ? 'Zehra has not chosen to answer. You may explicitly ask again.'
          : e.status === 'pending'
            ? 'Your question is waiting to reach Zehra. No answer yet.'
            : e.status === 'heard'
              ? 'Your question reached Zehra. No answer yet.'
              : 'This question ended without a completed answer.';
  const named = e.context
    ? state.replaceAll(
        'Zehra',
        e.person === 'yusuf'
          ? 'Yusuf'
          : e.person === 'danyal'
            ? 'Danyal'
            : e.person === 'serife'
              ? 'The Tepe household member'
              : 'Zehra',
      )
    : state;
  if (!e.ask) return named;
  const r = e.work?.reply;
  return `${state} ${r ? `Her later work answer is ${r.verdict}: “${r.says}” This is not arrival evidence.` : e.existingWork ? `Her existing work answer was ${e.existingWork.verdict}: “${e.existingWork.says}” No new work answer yet.` : 'The work request is still pending.'}`;
}
/** Structural validation also protects bound recovery, which has no input log here.
 * Full native files additionally replay all inputs before their state is installed. */
export function validateDialogueState(s: ValleyState): void {
  if (s.dialogue === undefined) {
    if (s.edition?.id === DIALOGUE_EDITION) throw new Error('Invalid Valley dialogue configuration.');
    return;
  }
  const d = s.dialogue;
  const fail = () => {
    throw new Error('Invalid Valley dialogue state.');
  };
  const minute = (n: unknown) =>
    typeof n === 'number' &&
    Number.isFinite(n) &&
    Number.isSafeInteger(Math.round(n * 60000)) &&
    Math.abs(n * 60000 - Math.round(n * 60000)) < 0.00001 &&
    n >= 0 &&
    n <= Math.max(s.minute, s.community.ingress / 60000);
  if (
    !d ||
    d.id !== DIALOGUE_EDITION ||
    (s.edition?.id !== PUBLIC_EDITION &&
      (s.reply || s.edition || s.pass || s.stewardCare || s.introduction || s.brokering)) ||
    Object.keys(d).some((k) => !['id', 'exchanges', 'place'].includes(k)) ||
    !Array.isArray(d.exchanges) ||
    (d.place !== undefined && typeof d.place !== 'string')
  )
    fail();
  const fields = [
    'turn',
    'house',
    'person',
    'visit',
    'leave',
    'prior',
    'line',
    'ask',
    'existingWork',
    'cut',
    'context',
    'saidAt',
    'words',
    'speechNote',
    'status',
    'hearing',
    'decisions',
    'activity',
    'endedAt',
    'answerNote',
    'work',
    'events',
    'answer',
  ];
  for (const [i, e] of d.exchanges.entries()) {
    if (
      !e ||
      Object.keys(e).some((k) => !fields.includes(k)) ||
      e.turn !== i ||
      (contextual(e.line) ? e.person !== CONTEXT_PEOPLE[e.line] : e.person !== 'zehra') ||
      !houseOf(s, e.house) ||
      !minute(e.saidAt) ||
      !minute(e.visit) ||
      !Number.isSafeInteger(Math.round(e.leave * 60000)) ||
      Math.abs(e.leave * 60000 - Math.round(e.leave * 60000)) >= 0.00001 ||
      e.leave <= e.saidAt ||
      e.saidAt < e.visit ||
      !['follow-up', 'work-need', 'after-cut', ...Object.keys(CONTEXT_PEOPLE)].includes(e.line) ||
      ![
        'pending',
        'heard',
        'talking',
        'withheld',
        'completed',
        'interrupted',
        'expired',
        'cancelled',
      ].includes(e.status) ||
      !e.prior ||
      !minute(e.prior.at) ||
      e.prior.at > e.saidAt ||
      typeof e.prior.words !== 'string' ||
      !e.prior.words ||
      typeof e.words !== 'string' ||
      !Array.isArray(e.decisions) ||
      !Array.isArray(e.events) ||
      !Number.isSafeInteger(e.speechNote) ||
      e.speechNote < 1 ||
      e.speechNote >= s.nextNote ||
      s.notes.some((n) => n.id === e.speechNote && (n.at !== e.saidAt || n.who !== KAHYA)) ||
      (e.endedAt !== undefined && !minute(e.endedAt))
    )
      fail();
    if (contextual(e.line)) {
      const c = e.context;
      if (
        !c ||
        s.edition?.id !== PUBLIC_EDITION ||
        Object.keys(c).some((k) => !['kind', 'input', 'at', 'source'].includes(k)) ||
        c.kind !== 'valley-context-request/1' ||
        !Number.isSafeInteger(c.input) ||
        c.input < 0 ||
        c.at !== e.saidAt ||
        !c.source ||
        e.ask !== undefined ||
        e.cut !== undefined
      )
        fail();
      if (c) {
        if (c.source.kind === 'note') {
          if (
            Object.keys(c.source).some((k) => !['kind', 'note'].includes(k)) ||
            !c.source.note ||
            c.source.note.id !== e.prior.id ||
            c.source.note.at !== e.prior.at ||
            c.source.note.at > c.at ||
            (c.source.note.words ?? c.source.note.text) !== e.prior.words ||
            c.source.note.house !== e.house ||
            (e.line === 'birth'
              ? c.source.note.kind !== 'birth' || c.source.note.who !== 'zehra'
              : e.line !== 'reciprocal-help' ||
                c.source.note.who !== 'zehra' ||
                c.source.note.words !== FOOD_QUESTION)
          )
            fail();
        } else if (
          c.source.kind !== 'house-description' ||
          Object.keys(c.source).some((k) => !['kind', 'house', 'text'].includes(k)) ||
          !['son', 'friendship'].includes(e.line) ||
          c.source.house !== e.house ||
          typeof c.source.text !== 'string' ||
          c.source.text !== e.prior.words ||
          e.prior.id !== 0 ||
          e.prior.at !== e.saidAt
        )
          fail();
      }
    } else if (e.context !== undefined) fail();
    if (e.line === 'after-cut') {
      const c = e.cut;
      if (
        !c ||
        Object.keys(c).some(
          (k) => !['kind', 'input', 'at', 'beat', 'standing', 'reaped', 'source'].includes(k),
        ) ||
        c.kind !== 'valley-cut-request/1' ||
        !Number.isSafeInteger(c.input) ||
        c.input < 0 ||
        c.at !== e.saidAt ||
        c.beat !== `cut-${yearOf(dayOfMinute(e.saidAt))}` ||
        !Number.isFinite(c.standing) ||
        c.standing < 0 ||
        c.standing > 0.5 ||
        !Number.isFinite(c.reaped) ||
        c.reaped < 0 ||
        !c.source ||
        c.source.id !== e.prior.id ||
        c.source.at !== e.prior.at ||
        c.source.at > c.at ||
        c.source.words !== FOOD_QUESTION ||
        c.source.words !== e.prior.words ||
        c.source.who !== e.person ||
        c.source.house !== e.house ||
        !['reply', 'voice'].includes(c.source.kind) ||
        e.ask !== undefined
      )
        fail();
    } else if (e.cut !== undefined) fail();
    if (
      e.hearing &&
      (!minute(e.hearing.deliveredAt) ||
        e.hearing.deliveredAt < e.saidAt ||
        !minute(e.hearing.percept.at) ||
        e.hearing.percept.at > e.hearing.deliveredAt ||
        e.hearing.percept.summary !== e.words ||
        !Array.isArray(e.hearing.attended) ||
        !Array.isArray(e.hearing.memoryTimes) ||
        e.hearing.memoryTimes.some((t) => t !== e.hearing?.percept.at))
    )
      fail();
    if (
      e.status === 'completed' &&
      (!e.hearing ||
        !e.activity ||
        e.endedAt === undefined ||
        e.endedAt < e.activity.endsAt ||
        e.endedAt - e.activity.startedAt < 5 ||
        !e.answer ||
        e.answer.at !== e.endedAt ||
        typeof e.answer.words !== 'string' ||
        !Number.isSafeInteger(e.answerNote) ||
        (e.answerNote ?? 0) >= s.nextNote)
    )
      fail();
    if (e.status !== 'completed' && e.answerNote !== undefined) fail();
  }
}
