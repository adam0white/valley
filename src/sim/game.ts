/**
 * The game around the valley: the player's inputs (each applied at an exact minute, so a run replays), the beats of
 * the term (who brings what, when), the ending at the elders' gathering, saves and the playtest export.
 */
import { FRAMEWORK_VERSION, type Person, recall, restore, snapshot } from '@adam0white/human-framework';
import { type AllianceChoice, allianceChoice } from './alliance.ts';
import { type BrokerChoice, brokerChoice } from './brokering.ts';
import { DAY, dateEnglish, dayOfMinute, doyOf, HOUR, yearOf } from './calendar.ts';
import { cancelDialogue, type DialogueOrder, speakDialogue, validateDialogueState } from './dialogue.ts';
import {
  allianceEdition,
  chooseTerm,
  dialogueEdition,
  type HearthTopic,
  knownEdition,
  PUBLIC_EDITION,
  passEdition,
  REPLY_EDITION,
  type RulesEdition,
  requestContribution,
  rulesOf,
  talkAtHearth,
} from './edition.ts';
import { introduce } from './introductions.ts';
import { passChoice } from './pass.ts';
import type { CastStart } from './passport.ts';
import { householdLabel, KAHYA, personLabel } from './people.ts';
import { mixSeed, strHash } from './rng.ts';
import {
  advanceTo,
  borrow,
  call,
  daysOfBread,
  dueFor,
  ease,
  give,
  houseOf,
  insist,
  type Job,
  type Knock,
  newValley,
  note,
  personOf,
  replyAtHearth,
  requestCastRelease,
  resetCaches,
  seize,
  syncCommunity,
  turnAway,
  underSeal,
  V,
  type ValleyState,
  type Verb,
  visit,
} from './valley.ts';
import type { Saying } from './voices.ts';

export const GAME_VERSION = '0.3.1';

export type Input =
  | (DialogueOrder & { at: number })
  | { at: number; verb: 'dialogue-cancel'; turn: number }
  | { at: number; verb: 'alliance'; choice: AllianceChoice }
  | { at: number; verb: 'broker'; choice: BrokerChoice }
  | { at: number; verb: 'pass'; choice: 'depart' | 'buy' | 'deliver' }
  | { at: number; verb: 'introduce' }
  | { at: number; verb: 'term-choice'; id: string; choice: string }
  | { at: number; verb: 'contribute'; house: string }
  | { at: number; verb: 'topic'; house: string; topic: HearthTopic }
  | { at: number; verb: 'call'; job: Job; houses: string[]; wage?: boolean }
  | { at: number; verb: 'insist'; ask: string; pid: string }
  | { at: number; verb: 'give'; house: string; kile: number }
  | { at: number; verb: 'seize'; house: string }
  | { at: number; verb: 'ease'; house: string }
  | { at: number; verb: 'reply'; house: string; saying?: Saying }
  | { at: number; verb: 'visit'; house: string; why?: Knock['what'] | 'call' }
  | { at: number; verb: 'turn-away'; knock: string }
  | { at: number; verb: 'borrow'; kile: number }
  | { at: number; verb: 'release-cast'; person: string };

export interface Game {
  valley: ValleyState;
  inputs: Input[];
  plainEnglish?: boolean;
  cast?: CastStart;
}

export function newGame(
  seed: number,
  cast?: CastStart,
  preflight = false,
  plainEnglish = true,
  rules?: RulesEdition,
): Game {
  if (rules !== undefined && !knownEdition(rules)) throw new Error('Unknown Valley rules edition.');
  const valley = newValley(seed, cast, preflight, plainEnglish, rules);
  const g: Game = { valley, inputs: [], plainEnglish, ...(cast ? { cast: structuredClone(cast) } : {}) };
  beats(g);
  return g;
}

/** Apply an input now (at the valley's minute) and log it. Returns false if it did nothing. */
/** An input before it is stamped with the minute it was given. */
export type Order = Input extends infer I ? (I extends Input ? Omit<I, 'at'> : never) : never;

export function act(g: Game, input: Order): boolean {
  const i = { ...input, at: g.valley.minute } as Input;
  const ok = apply(g, i);
  if (ok) g.inputs.push(i);
  return ok;
}

function apply(g: Game, i: Input): boolean {
  const s = g.valley;
  switch (i.verb) {
    case 'dialogue': {
      const { at: _at, ...order } = i;
      return speakDialogue(s, order);
    }
    case 'dialogue-cancel':
      return Object.keys(i).every((k) => ['at', 'verb', 'turn'].includes(k)) && cancelDialogue(s, i.turn);
    case 'reply':
      return (
        (i.saying === undefined || ['listen', 'finish', 'rain'].includes(i.saying)) &&
        replyAtHearth(s, i.house, i.saying ?? 'listen')
      );
    case 'broker':
      return brokerChoice(s, i.choice);
    case 'alliance':
      return allianceChoice(s, i.choice);
    case 'pass':
      return passChoice(s, i.choice);
    case 'introduce':
      return introduce(s);
    case 'term-choice':
      return chooseTerm(s, i.id, i.choice);
    case 'contribute':
      return requestContribution(s, i.house);
    case 'topic':
      return talkAtHearth(s, i.house, i.topic);
    case 'release-cast':
      return requestCastRelease(s, i.person);
    case 'call': {
      const a = call(s, i.job, i.houses, i.wage ? { wage: true } : {});
      if (!a) return false;
      const what =
        i.job === 'reap-agha'
          ? 'cut the landowner’s barley'
          : i.job === 'build-mill'
            ? 'carry stone for the mill'
            : 'bring the share';
      const who =
        i.houses.length > 2 ? 'the hamlet' : i.houses.map((h) => houseOf(s, h)?.name ?? h).join(' and ');
      note(s, {
        at: s.minute,
        kind: 'story',
        text:
          i.job === 'bring-share'
            ? `You asked the village announcer to call ${who} to bring the landowner’s share to the granary.`
            : `You asked the village announcer to call ${who} to ${what}${i.wage ? (i.job === 'build-mill' && s.edition ? ', with grain from the granary for completed carrying while grain remains' : ', with one eighth of the harvest as pay') : ''}.`,
        weight: 0.8,
      });
      return true;
    }
    case 'insist': {
      const ok = insist(s, i.ask, i.pid);
      if (ok)
        note(s, {
          at: s.minute,
          kind: 'story',
          text: `You told ${personLabel(
            personOf(s, i.pid) ?? { name: 'someone' },
            s.households.find((h) => h.members.includes(i.pid)),
          )} to do the work without another delay.`,
          who: i.pid,
          weight: 1,
        });
      return ok;
    }
    case 'give':
      return give(s, i.house, i.kile) > 0;
    case 'seize':
      return seize(s, i.house) >= 0;
    case 'ease':
      return ease(s, i.house);
    case 'visit': {
      const back = visit(s, i.house, i.why ?? 'call');
      if (back === undefined) return false;
      const h = houseOf(s, i.house);
      note(s, {
        at: s.minute,
        kind: 'visit',
        text: `You walked down to ${h ? householdLabel(h) : 'the house'}${i.why === 'wedding' ? ' for the wedding' : i.why === 'death' ? ' to sit with them' : i.why === 'birth' ? ' to see the child' : ''}.`,
        house: i.house,
        weight: 0.6,
      });
      return true;
    }
    case 'borrow':
      return borrow(s, i.kile);
    case 'turn-away':
      return turnAway(s, i.knock);
  }
}

/** The sim always moves in these steps, in play and in replay alike, so a run replays exactly. */
export const QUANTUM = 30;

/**
 * Live the game to minute `to` (rounded down to a quantum) in fixed quanta. With `replay`, logged inputs are applied
 * at the start of the quantum they were given in.
 */
export function step(g: Game, to: number, replay?: Input[]) {
  const s = g.valley;
  let k = replay ? replay.findIndex((i) => i.at >= s.minute) : -1;
  if (k < 0 && replay) k = replay.length;
  while (s.minute + QUANTUM <= to && !s.flags.ended) {
    if (replay) {
      while (k < replay.length && (replay[k]?.at ?? Infinity) <= s.minute) {
        const i = replay[k++];
        if (i && i.at === s.minute && apply(g, i)) g.inputs.push(i);
      }
    }
    advanceTo(s, s.minute + QUANTUM);
    beats(g);
  }
  if (replay) {
    while (k < replay.length && (replay[k]?.at ?? Infinity) <= s.minute) {
      const i = replay[k++];
      if (i && i.at === s.minute && apply(g, i)) g.inputs.push(i);
    }
  }
}

// ---------- beats of the term ----------

const beat = (g: Game, id: string) => {
  if (g.valley.flags.beats.includes(id)) return false;
  g.valley.flags.beats.push(id);
  return true;
};

const reveal = (g: Game, v: Verb) => {
  if (!g.valley.flags.verbs.includes(v)) g.valley.flags.verbs.push(v);
};

/** The day the term ends: the elders' gathering, mid-Aralık of the third year. */
export const END_DAY = 365 * 2 + (349 - 198);

export function beats(g: Game) {
  const s = g.valley;
  const day = dayOfMinute(s.minute);
  const doy = doyOf(day);
  const year = yearOf(day);
  if (beat(g, 'open')) {
    note(s, {
      at: s.minute,
      kind: 'story',
      text: `You brought the landowner’s letter up the valley. He wants his barley cut before the rains. His payment of ${s.agha.due} grain measures must be ready by ${dateEnglish(s.agha.dueDay)}. The last steward left during the night in spring. His house above the mill stands empty.`,
      weight: 3,
    });
    note(s, {
      at: s.minute + 1,
      kind: 'weather',
      text: 'Clouds are building over the ridge. The old men say it will rain in two days.',
      weight: 2,
    });
  }
  // The first put-off reply opens insisting and visiting.
  if (
    s.asks.some((a) => Object.values(a.replies).some((r) => r.verdict === 'deferred')) &&
    beat(g, 'insist')
  ) {
    reveal(g, 'insist');
    reveal(g, 'visit');
    note(s, {
      at: s.minute,
      kind: 'story',
      text: 'The local overseer stands beside you and says, “Send word again and they’ll come, steward. Or walk down and ask them yourself. Some households will only listen if you visit them.”',
      words: 'Some households will only listen if you visit them.',
      who: 'osman',
      weight: 2,
    });
  }
  if (day >= 1 && beat(g, 'reeve')) {
    note(s, {
      at: s.minute,
      kind: 'story',
      text: 'The local overseer says he knows every house in the lower lanes. His guesses are written beside yours now, in his hand.',
      who: 'osman',
      weight: 1.5,
    });
  }
  // The threshing and the due.
  if (doy >= 220 && year === 1 && beat(g, 'take')) {
    reveal(g, 'take');
    reveal(g, 'ease');
    reveal(g, 'seize');
    note(s, {
      at: s.minute,
      kind: 'letter',
      text: `People have separated much of the grain from the cut barley. The account book says what each house owes the landowner. His rider comes on ${dateEnglish(s.agha.dueDay)} for ${s.agha.due} grain measures. The granary holds ${Math.round(s.agha.granary)}. Ask households to bring their shares. You can reduce the shares of those who cannot pay, or send the local overseer’s men to collect them.`,
      weight: 3,
    });
  }
  const leanHouse = s.households.some((h) => underSeal(s, h) && h.members.length && daysOfBread(s, h) < 30);
  if ((leanHouse || s.knocks.some((k) => k.what === 'grain' && k.at <= s.minute)) && beat(g, 'give')) {
    reveal(g, 'give');
    note(s, {
      at: s.minute,
      kind: 'story',
      text: 'The local overseer says quietly, “The granary belongs to the landowner, steward, but you control who receives its grain. The rider will count any grain you give away as missing.”',
      words: 'You control who receives grain from the granary.',
      who: 'osman',
      weight: 2,
    });
  }
  // Hunger in the lanes when the granary is low: the reeve says the landowner can be written to.
  const lean = s.households.filter(
    (h) => underSeal(s, h) && h.members.length && daysOfBread(s, h) < 25,
  ).length;
  if (lean >= 2 && s.agha.granary < 60 && beat(g, 'borrow')) {
    reveal(g, 'borrow');
    note(s, {
      at: s.minute,
      kind: 'story',
      text: 'The local overseer came by at dusk. Two households have almost no food left, he said, and the granary is low. The landowner will lend grain if you write to him. His rider will collect the loan with a quarter more.',
      words: 'He will lend grain. He never forgets a loan.',
      who: 'osman',
      weight: 2.5,
    });
  }
  if (s.knocks.some((k) => k.what !== 'grain')) reveal(g, 'attend');
  // The first winter: the millwright (the fields are idle and the stone slides on the snow). Year two: the upper hamlet.
  if ((year > 1 || doy >= 330) && beat(g, 'mill')) {
    s.agha.millOpen = true;
    note(s, {
      at: s.minute,
      kind: 'letter',
      text: 'A mill builder from the city came through the snow with the landowner’s letter. He will build a mill on the stream if the valley carries the stone. The work needs six hundred hours of labour. The fields need no work until spring. People can slide the stone on sledges over frozen ground. When the mill works, the landowner will take his share in flour. He will ask the valley for forty fewer grain measures.',
      weight: 3,
    });
  }
  if (year === 2 && doy >= 160 && beat(g, 'upper')) {
    s.flags.upper = true;
    s.agha.due = dueFor(s);
    note(s, {
      at: s.minute,
      kind: 'letter',
      text: `The landowner has bought the upper hamlet’s debts. You have authority over its six houses from this harvest. You have never visited any of them. The payment he requires rises to ${s.agha.due} grain measures.`,
      weight: 3,
    });
  }
  // The mill rising, in what can be seen at the stream.
  const MILL_SIGHTS: [number, string][] = [
    [
      0.25,
      'The channel for the mill water has been dug beside the stream. The local overseer walked its length twice and said it was straight.',
    ],
    [0.5, 'The mill walls are up to a man’s chest. Children dare each other to walk along them.'],
    [
      0.75,
      'Both millstones arrived on the sledge. The journey took two days. Everyone in the valley went to look.',
    ],
  ];
  if (s.agha.millOpen)
    for (const [f, text] of MILL_SIGHTS)
      if (s.agha.mill >= f * V.millHours && beat(g, `mill-${f}`))
        note(s, { at: s.minute, kind: 'work', text, weight: 2 });
  if (s.agha.millOpen && s.agha.mill >= V.millHours && beat(g, 'mill-done')) {
    s.agha.due = dueFor(s);
    note(s, {
      at: s.minute,
      kind: 'work',
      text: 'The mill worked for the first time. The children ran beside its water channel. The landowner now requires forty fewer grain measures.',
      weight: 3,
    });
  }
  // Losing: the due short twice.
  if (s.agha.missed >= 2 && !s.flags.ended && s.minute >= s.agha.dueDay * DAY + 13 * HOUR) {
    s.flags.ended = 'dismissed';
    note(s, {
      at: s.minute,
      kind: 'letter',
      text: 'The rider came back with a second sealed letter. The landowner thanks you for your service. Another man will replace you before the snow.',
      weight: 3,
    });
  }
  if (day >= END_DAY && !s.flags.ended) {
    s.flags.ended = 'term';
    note(s, {
      at: s.minute,
      kind: 'story',
      text: 'The elders gathered at the residence, as they do at the end of a steward’s term.',
      weight: 3,
    });
  }
  if (s.flags.ended && !s.flags.gathering) s.flags.gathering = readGathering(g);
}

// ---------- the ending ----------

export interface ElderWord {
  id: string;
  name: string;
  house: string;
  words: string;
}

/** What the elders say at the gathering: each line drawn from that person's own memory of you. */
export function gathering(g: Game): { elders: ElderWord[]; letter: string } {
  return g.valley.flags.gathering ?? readGathering(g);
}

const WARM = [
  'You asked, and mostly you listened. That is more than the last one did.',
  'Come back in the spring, but do not come as steward.',
  'You were the landowner’s man, and somehow ours too. I don’t know how you managed it.',
  'When the next one comes, I will tell him how it was done.',
  'There was bread in this house every winter you were here. I noticed.',
  'You never shouted. People remember a steward who never shouted.',
  'If you pass this way again, you are welcome to eat with us.',
];
/** Warm lines that only fit a steward who came down this lane. */
const WARM_VISITED = [
  'When you knocked, we opened the door. Not every steward can say that.',
  'You ate our bread like a neighbour. They don’t say that of many in this house.',
  'You sat on our step and asked about the goats. Nobody from the residence ever asked about the goats.',
  'The children still call the stool by the door the steward’s stool.',
];
/** For a house the open hand fed. */
const OPEN_HAND = [
  'The landowner lost some barley and we kept our children. I know which I would choose.',
  'You sent us a sack of grain in the winter when we needed it. The landowner can count it if he likes.',
  'They say you gave his grain away. They say it as if it were a bad thing.',
  'You were a poor steward and a good neighbour. I would rather have a good neighbour.',
  'The rider recorded that you had not paid enough. We remember you as the person who brought us a sack of grain.',
  'Nobody in this house went to bed hungry while you held the key. Put that in the landowner’s book.',
];
/** For a house that hardly knew you. */
const STRANGER = [
  'We hardly saw you. The village announcer did your asking.',
  'You never came down our lane. I couldn’t tell you what you were like.',
  'I would recognise the landowner’s rider on the road more easily than I would recognise you.',
  'Which steward were you? Forgive me. There have been several.',
  'We heard your name at the mill. That is all we had of you.',
  'If you came by, nobody told me.',
];
const PLAIN = [
  'You were here {years}. We will see what the next one is like.',
  'The barley came in. That is what a steward is for.',
  'We had no quarrel with you. Write that down, it is rare.',
  'You came when you needed something. So did the last one.',
  'The young ones say you were fair. The young ones say a lot of things.',
  'You kept the landowner’s account book. You never saw ours.',
  'I have nothing to complain about. I have nothing to praise either.',
  'You did the work of the steward. I can’t say better or worse.',
  'The rider came and went, and so did you. The valley is still here.',
  'Ask me again in ten years. Time changes how we remember stewards.',
  'We paid, and you counted. That was most of what we did together.',
  'You were not the worst. I’ve seen the worst.',
];
const COLD = [
  'We did what you asked. Don’t ask me to say more than that.',
  'Your book will say what it says. Ours says something else.',
  'The next one will hear about you before he unpacks.',
  'I have nothing to say to the landowner’s man.',
  'You knew where our door was when the share was due.',
  'I hope your journey goes well. I hope you leave soon.',
  'We will be civil to the next one too. It costs nothing.',
  'I said what I thought at the well. I won’t say it twice.',
];

const asYou = (summary: string) =>
  summary.replace(/^(the )?kahya’s /i, 'when your ').replace(/^(the )?kahya /i, 'when you ');

function pickLine(pool: string[], key: string, used: Set<string>): string {
  const start = (strHash(key) >>> 0) % pool.length;
  for (let k = 0; k < pool.length; k++) {
    const line = pool[(start + k) % pool.length] ?? '';
    if (!used.has(line)) {
      used.add(line);
      return line;
    }
  }
  return pool[start] ?? '';
}

function readGathering(g: Game): { elders: ElderWord[]; letter: string } {
  const s = g.valley;
  const elders: ElderWord[] = [];
  const used = new Set<string>();
  const served = Math.max(1, yearOf(dayOfMinute(s.minute)));
  const years = ['one year', 'two years', 'three years'][Math.min(2, served - 1)] ?? 'three years';
  for (const h of s.households) {
    if (!underSeal(s, h)) continue;
    const head = h.members.map((m) => personOf(s, m)).find((p): p is Person => !!p && p.body.alive);
    if (!head) continue;
    const trust = head.will.voices.find((v) => v.voiceId === KAHYA)?.trust ?? 0.5;
    const eps = recall(head, { actorId: KAHYA, limit: 6 });
    const worst = eps.filter((e) => e.valence < -0.2).sort((a, b) => a.valence - b.valence)[0];
    const best = eps.filter((e) => e.valence > 0.2).sort((a, b) => b.valence - a.valence)[0];
    const visited = s.kahyaState.seen[h.id] !== undefined;
    // A death from hunger under your seal is what this house says, before anything else.
    const starved = (s.stats.starved ?? []).find((d) => d.house === h.id);
    const deadName = starved ? personLabel({ name: starved.name }, h) : undefined;
    const hard = !!starved?.hard || (s.stats.hard ?? []).includes(h.id);
    let words: string;
    if (deadName)
      words = hard
        ? `${deadName.charAt(0).toUpperCase() + deadName.slice(1)} died with nothing in the jar. You had the key to the granary. That is all I will say.`
        : `${deadName.charAt(0).toUpperCase() + deadName.slice(1)} died hungry, the winter you were here. I am not saying you caused it. I am not saying you did not.`;
    else if (worst && worst.at < 0 && (trust < 0.35 || !best))
      // A memory from before your term: the office, not you.
      words = `I remember ${worst.summary.replace(/^the kahya/, 'when the last kahya')}. The steward had the same authority.`;
    else if (worst && (trust < 0.35 || !best))
      words = `I remember ${asYou(worst.summary)}. I won’t pretend I don’t.`;
    else if (
      (s.stats.given ?? 0) >= 40 &&
      trust > 0.45 &&
      (s.kahyaState.acts?.[h.id] ?? []).some((x) => /gave/.test(x.what))
    )
      // The open hand's own reward: the houses it fed say so.
      words = pickLine(OPEN_HAND, h.id, used);
    else if (best && trust > 0.5) words = `I remember ${asYou(best.summary)}. Write that in your book.`;
    else if (!visited && eps.length < 2 && trust >= 0.3) words = pickLine(STRANGER, h.id, used);
    else
      words = pickLine(
        trust > 0.55 ? (visited ? [...WARM_VISITED, ...WARM] : WARM) : trust < 0.3 ? COLD : PLAIN,
        h.id,
        used,
      ).replace('{years}', years);
    elders.push({ id: head.id, name: head.name, house: h.name, words });
  }
  const meanTrust =
    s.people.reduce((a, p) => a + (p.will.voices.find((v) => v.voiceId === KAHYA)?.trust ?? 0.5), 0) /
    Math.max(1, s.people.length);
  // The edges of the office, in the agha's hand: an iron seal pleases him, an open hand worries him.
  const seized = s.stats.seized ?? 0;
  const hungryDead = s.stats.starved?.length ?? 0;
  const given = s.stats.given ?? 0;
  const letter =
    s.flags.ended !== 'dismissed' && s.agha.missed === 0 && seized >= 6
      ? `The landowner’s letter renews your authority and raises your pay. He writes that the shares have never been collected so fully. ${hungryDead ? `He does not mention the ${hungryDead === 1 ? 'one who' : `${hungryDead} who`} died hungry. The elders mentioned it.` : 'The elders were less pleased.'}`
      : s.flags.ended === 'dismissed' && given >= 40 && hungryDead === 0
        ? `The landowner’s letter thanks you for your service, and ends it. Your term was meant to last three harvests. It ended early. He has worked out where ${Math.round(given)} grain measures of his barley went, he writes, and he is not a charity. Nobody in the valley died hungry while you were steward. He does not mention that. The elders mentioned it.`
        : s.flags.ended !== 'dismissed' && given >= 40
          ? `The landowner’s letter renews your authority${s.agha.missed ? ', for now' : ''}. It asks, twice, where ${Math.round(given)} grain measures of his barley went. In the margin you write the names of the houses that ate it.`
          : s.flags.ended === 'dismissed'
            ? 'The landowner’s letter thanks you for your service, and ends it. Your term was meant to last three harvests. It ended early. Another man is now steward.'
            : s.agha.missed === 0 && meanTrust > 0.45
              ? 'The landowner’s letter renews your authority for another term, and asks how you did it.'
              : s.agha.missed === 0
                ? 'The landowner’s letter renews your authority. It says nothing about the valley.'
                : 'The landowner’s letter renews your authority, for now. It mentions the year you were short.';
  return { elders, letter };
}

// ---------- saves and the export ----------

export interface SavedGame {
  rules?: RulesEdition;
  /** Initial narration choice; omitted current-edition files use the fresh-game default. */
  plainEnglish?: boolean;
  castHeads?: Record<string, import('@adam0white/lab-client').PersonaEnvelope>;
  castSources?: Record<string, { revision: string; person: Person }>;
  cast?: CastStart;
  game: 'valley';
  version: string;
  framework: string;
  seed: number;
  minute: number;
  inputs: Input[];
  state: ValleyState;
  fingerprint: string;
  savedAt: string;
  /** In-fiction label: "Volume III, Ağustos of year one". */
  label: string;
}

/** A notebook run is replayed from seed and inputs; downloads retain the full saved state. */
export type CompactRun = Omit<SavedGame, 'state' | 'savedAt'>;

/** A detached plain-JSON copy of the valley (people through HF `snapshot`). */
export function stateJson(s: ValleyState): ValleyState {
  syncCommunity(s);
  const { people, kahya, ...rest } = s;
  return {
    ...structuredClone(rest),
    people: people.map((p) => tidy(snapshot(p))),
    kahya: tidy(snapshot(kahya)),
  } as ValleyState;
}

/** HF `restore` drops an empty family record; drop it here too so a save and its restore print the same. */
function tidy(p: Person): Person {
  if (p.family && Object.keys(p.family).length === 0) delete p.family;
  return p;
}

/** Reply-only state must never activate October mechanics under a reply receipt.
 * Shared by file loads and bound recovery volumes; old states without reply are untouched.
 */
function validateReplyState(s: ValleyState): void {
  if (s.reply === undefined) return;
  const r = s.reply;
  if (
    !r ||
    typeof r !== 'object' ||
    Array.isArray(r) ||
    r.id !== REPLY_EDITION ||
    (s.edition?.id !== PUBLIC_EDITION &&
      (s.edition !== undefined ||
        s.pass !== undefined ||
        s.stewardCare !== undefined ||
        s.introduction !== undefined ||
        s.brokering !== undefined)) ||
    !Array.isArray(r.visits) ||
    Object.keys(r).some((key) => key !== 'id' && key !== 'visits') ||
    !Number.isSafeInteger(s.minute) ||
    s.minute < 0 ||
    s.minute > (END_DAY + 1) * DAY ||
    r.visits.length > 3 * (Math.floor(s.minute / 130) + 1)
  )
    throw new Error('Invalid Valley reply edition state.');
  const keys = new Set<string>();
  for (const key of r.visits) {
    if (typeof key !== 'string') throw new Error('Invalid Valley reply visit.');
    const match = /^([\p{L}\p{N}_-]{1,100}):(0|[1-9][0-9]*)(?::(?:finish|rain))?$/u.exec(key);
    const at = match ? Number(match[2]) : NaN;
    if (
      !match ||
      !Number.isSafeInteger(at) ||
      at < 0 ||
      at > s.minute ||
      !s.households.some((h) => h.id === match[1]) ||
      keys.has(key)
    )
      throw new Error('Invalid Valley reply visit.');
    keys.add(key);
  }
}

export function restoreState(json: ValleyState): ValleyState {
  if (
    json.edition?.id === PUBLIC_EDITION &&
    (!json.reply || !json.dialogue || !json.pass || !json.stewardCare)
  )
    throw new Error('Invalid Valley public edition state.');
  validateReplyState(json);
  validateDialogueState(json);
  const { people, kahya, ...rest } = json;
  resetCaches();
  return {
    ...structuredClone(rest),
    people: people.map((p) => restore(p)),
    kahya: restore(kahya),
  } as ValleyState;
}

/** A short hash of the world truth and every person's state. */
export function fingerprint(s: ValleyState): string {
  // Keys sorted: a restored person may hold the same fields in another order.
  const json = JSON.stringify(stateJson(s), (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const roman = (n: number): string => {
  const parts: [number, string][] = [
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let out = '';
  let k = Math.max(1, Math.floor(n));
  for (const [v, r] of parts)
    while (k >= v) {
      out += r;
      k -= v;
    }
  return out;
};
export const volumeLabel = (s: ValleyState, n: number) =>
  `Volume ${roman(n + 1)}, ${dateEnglish(dayOfMinute(s.minute))} of year ${['one', 'two', 'three', 'four'][yearOf(dayOfMinute(s.minute)) - 1] ?? yearOf(dayOfMinute(s.minute))}`;

export function save(g: Game, n = 0): SavedGame {
  return {
    ...(g.cast ? { cast: structuredClone(g.cast) } : {}),
    ...(rulesOf(g.valley) ? { rules: rulesOf(g.valley) } : {}),
    game: 'valley',
    plainEnglish: g.plainEnglish ?? true,
    version: GAME_VERSION,
    framework: FRAMEWORK_VERSION,
    seed: g.valley.seed,
    minute: g.valley.minute,
    inputs: structuredClone(g.inputs),
    state: stateJson(g.valley),
    fingerprint: fingerprint(g.valley),
    savedAt: new Date().toISOString(),
    label: volumeLabel(g.valley, n),
  };
}

/** Compact the dialog's captured export, rather than reading a game that may have moved on. */
export function compactRun(g: Game | SavedGame, n = 0): CompactRun {
  if ('state' in g)
    return {
      ...(g.cast ? { cast: structuredClone(g.cast) } : {}),
      ...(g.castHeads ? { castHeads: structuredClone(g.castHeads) } : {}),
      ...(g.rules ? { rules: g.rules } : {}),
      game: g.game,
      version: g.version,
      framework: g.framework,
      plainEnglish: g.plainEnglish ?? true,
      seed: g.seed,
      minute: g.minute,
      inputs: structuredClone(g.inputs),
      fingerprint: g.fingerprint,
      label: g.label,
    };
  return {
    ...(g.cast ? { cast: structuredClone(g.cast) } : {}),
    ...(rulesOf(g.valley) ? { rules: rulesOf(g.valley) } : {}),
    game: 'valley',
    plainEnglish: g.plainEnglish ?? true,
    version: GAME_VERSION,
    framework: FRAMEWORK_VERSION,
    seed: g.valley.seed,
    minute: g.valley.minute,
    inputs: structuredClone(g.inputs),
    fingerprint: fingerprint(g.valley),
    label: volumeLabel(g.valley, n),
  };
}

/** Key order is not state. Preserve every value when comparing the new edition's replay. */
const exactKeys = (_key: string, value: unknown): unknown =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
    : value;

export function load(saved: SavedGame | CompactRun): Game {
  if (
    saved.inputs.some(
      (i) => (i.verb === 'dialogue' || i.verb === 'dialogue-cancel') && !dialogueEdition(saved.rules),
    )
  )
    throw new Error('Dialogue commands require the dialogue edition.');
  if (saved.rules !== undefined && !knownEdition(saved.rules))
    throw new Error('Unknown Valley rules edition.');
  if ('state' in saved && dialogueEdition(saved.rules) !== !!saved.state.dialogue)
    throw new Error('Invalid Valley dialogue configuration.');
  if ('state' in saved && rulesOf(saved.state) !== saved.rules)
    throw new Error('The saved rules do not match the run.');
  if (
    'state' in saved &&
    (passEdition(saved.rules) !== !!saved.state.pass ||
      ((saved.state.introduction || saved.state.brokering) && !passEdition(saved.rules)))
  )
    throw new Error('The saved pass world does not match its edition.');
  if (
    'state' in saved &&
    (allianceEdition(saved.rules) !== !!saved.state.stewardCare ||
      (saved.state.brokering && !allianceEdition(saved.rules)) ||
      (saved.state.pass?.alliance && !allianceEdition(saved.rules)))
  )
    throw new Error('The saved alliance world does not match its edition.');
  if (saved.version !== GAME_VERSION || saved.framework !== FRAMEWORK_VERSION)
    throw new Error('This run uses an older Valley edition. Export it for safekeeping and start fresh.');
  if (saved.cast) newGame(saved.seed, saved.cast);
  if ('state' in saved && saved.state.dialogue) {
    validateDialogueState(saved.state);
    const rebuilt = replay(
      saved.seed,
      structuredClone(saved.inputs),
      saved.minute,
      saved.cast,
      saved.plainEnglish ?? true,
      saved.rules,
    );
    if (
      JSON.stringify(stateJson(rebuilt.valley), exactKeys) !== JSON.stringify(saved.state, exactKeys) ||
      JSON.stringify(rebuilt.inputs) !== JSON.stringify(saved.inputs)
    )
      throw new Error('Invalid Valley dialogue replay state.');
  }
  if ('state' in saved)
    return {
      valley: restoreState(saved.state),
      plainEnglish: saved.plainEnglish ?? true,
      inputs: structuredClone(saved.inputs),
      ...(saved.cast ? { cast: structuredClone(saved.cast) } : {}),
    };
  const g = replay(
    saved.seed,
    structuredClone(saved.inputs),
    saved.minute,
    saved.cast,
    saved.plainEnglish ?? true,
    saved.rules,
  );
  if (dialogueEdition(saved.rules) && JSON.stringify(g.inputs) !== JSON.stringify(saved.inputs))
    throw new Error('Invalid Valley dialogue commands.');
  if (fingerprint(g.valley) !== saved.fingerprint)
    throw new Error(
      'This file does not replay the same way in this version of The Valley. It may come from an older version. Start a new game instead.',
    );
  return g;
}

/** Rebuild a run from its seed and inputs alone. */
export function replay(
  seed: number,
  inputs: Input[],
  to: number,
  cast?: CastStart,
  plainEnglish = true,
  rules?: RulesEdition,
): Game {
  const g = newGame(seed, cast, false, plainEnglish, rules);
  step(g, to, inputs);
  return g;
}

export const seedFrom = (s: string) => mixSeed(strHash(s), 7) >>> 0;
export { DAY, HOUR };
