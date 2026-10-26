/** Valley owns this closed Zehra scene and its authored words. HF owns attention,
 * voluntary choice, the body and timed activity. No free-text understanding or bargain is claimed. */
import {
  type Activity,
  type Affordance,
  type DecisionRecord,
  type Outcome,
  type Percept,
  type Person,
  perceive,
  type SimEvent,
} from '@adam0white/human-framework';
import { DAY, dateEnglish } from './calendar.ts';
import { DIALOGUE_EDITION } from './edition.ts';
import { KAHYA } from './people.ts';
import { houseOf, note, openAsksFor, personOf, promote, type Reply, type ValleyState } from './valley.ts';

export type DialogueLine = 'follow-up' | 'work-need';
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
  const location = p.activity?.affordance.placeId ?? s.dialogue?.place;
  return (
    !!p.body.alive &&
    p.activity?.mode !== 'sleep' &&
    !!houseOf(s, house)?.members.includes(p.id) &&
    location === `house:${house}`
  );
}
function attended(s: ValleyState, house: string, visit: number, at: number): boolean {
  const v = s.kahyaState.visit;
  return !!v && v.house === house && v.arrive === visit && v.arrive <= at && at < v.leave;
}
export function dialogueChoices(s: ValleyState): DialogueOrder[] {
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
  return choices;
}
export function dialogueWords(s: ValleyState, o: DialogueOrder): string {
  const prior = s.notes.find((n) => n.id === o.prior);
  return o.line === 'follow-up'
    ? `You said, “${prior?.words ?? ''}” What would you like me to know about that?`
    : `Rain is due on ${dateEnglish(2)}. I need hands to cut the landowner’s barley. Can you help before then?`;
}
export function speakDialogue(s: ValleyState, o: DialogueOrder): boolean {
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
  if (!choice) return false;
  const prior = s.notes.find((n) => n.id === o.prior),
    v = s.kahyaState.visit;
  if (!prior?.words || !v || !s.dialogue) return false;
  const words = dialogueWords(s, o);
  const ask = s.asks.find((a) => a.id === o.ask);
  const e: Exchange = {
    turn: o.turn,
    house: o.house,
    person: o.person,
    visit: o.visit,
    leave: v.leave,
    prior: { id: prior.id, at: prior.at, words: prior.words, ...(prior.ask ? { ask: prior.ask } : {}) },
    line: o.line,
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
    text: `You say to Zehra, “${words}” No answer yet.`,
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
    text: 'Your question reached Zehra. Hearing is separate from choosing to speak. No answer yet.',
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
      effort: 0.05,
      advertises: { belonging: 0.12, leisure: 0.06 },
      tags: ['social'],
    },
  ];
}
export function captureDialogue(s: ValleyState, p: Person, offer: Affordance, record: DecisionRecord): void {
  if (!s.dialogue || p.id !== 'zehra') return;
  s.dialogue.place = offer.placeId;
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
      text: 'Zehra sits to speak with you. The talk has not finished.',
      weight: 2,
    });
  } else if (e.status === 'heard') {
    e.status = 'withheld';
    e.endedAt = p.now;
    note(s, {
      at: p.now,
      kind: 'story',
      house: e.house,
      text: 'Zehra has not chosen to answer this question. You may ask again while the visit permits.',
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
        text: 'Zehra answers your question after sitting with you:',
        words:
          e.line === 'follow-up'
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
  if (!e.ask) return state;
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
  const minute = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= s.minute;
  if (
    !d ||
    d.id !== DIALOGUE_EDITION ||
    s.reply ||
    s.edition ||
    s.pass ||
    s.stewardCare ||
    s.introduction ||
    s.brokering ||
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
      e.person !== 'zehra' ||
      !houseOf(s, e.house) ||
      !minute(e.saidAt) ||
      !minute(e.visit) ||
      !Number.isSafeInteger(e.leave) ||
      e.leave <= e.saidAt ||
      e.saidAt < e.visit ||
      !['follow-up', 'work-need'].includes(e.line) ||
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
    if (
      e.hearing &&
      (!minute(e.hearing.deliveredAt) ||
        e.hearing.deliveredAt < e.saidAt ||
        e.hearing.percept.at !== e.hearing.deliveredAt ||
        e.hearing.percept.summary !== e.words ||
        !Array.isArray(e.hearing.attended) ||
        !Array.isArray(e.hearing.memoryTimes) ||
        e.hearing.memoryTimes.some((t) => t !== e.hearing?.deliveredAt))
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
