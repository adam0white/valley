/**
 * The game around the valley: the player's inputs (each applied at an exact minute, so a run replays), the beats of
 * the term (who brings what, when), the ending at the elders' gathering, saves and the playtest export.
 */
import { FRAMEWORK_VERSION, type Person, recall, restore, snapshot } from '@adam0white/human-framework';
import { DAY, dateWords, dayOfMinute, doyOf, HOUR, yearOf } from './calendar.ts';
import { KAHYA } from './people.ts';
import { mixSeed, strHash } from './rng.ts';
import {
  type Ask,
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

export const GAME_VERSION = '0.1.0';

export type Input =
  | { at: number; verb: 'call'; job: Job; houses: string[]; wage?: boolean }
  | { at: number; verb: 'insist'; ask: string; pid: string }
  | { at: number; verb: 'give'; house: string; kile: number }
  | { at: number; verb: 'seize'; house: string }
  | { at: number; verb: 'ease'; house: string }
  | { at: number; verb: 'visit'; house: string; why?: Knock['what'] | 'call' }
  | { at: number; verb: 'turn-away'; knock: string }
  | { at: number; verb: 'borrow'; kile: number };

export interface Game {
  valley: ValleyState;
  inputs: Input[];
}

export function newGame(seed: number): Game {
  const valley = newValley(seed);
  const g: Game = { valley, inputs: [] };
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
    case 'call': {
      const a = call(s, i.job, i.houses, i.wage ? { wage: true } : {});
      if (!a) return false;
      const what =
        i.job === 'reap-agha' ? 'the agha’s barley' : i.job === 'build-mill' ? 'the mill' : 'the share';
      const who =
        i.houses.length > 2 ? 'the hamlet' : i.houses.map((h) => houseOf(s, h)?.name ?? h).join(' and ');
      note(s, {
        at: s.minute,
        kind: 'story',
        text:
          i.job === 'bring-share'
            ? `You had the crier call ${who} to bring the agha’s share to the granary.`
            : `You had the crier call ${who} to ${what}${i.wage ? ', one sheaf in eight for their trouble' : ''}.`,
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
          text: `You sent word again to ${personOf(s, i.pid)?.name ?? 'them'}: no more putting it off.`,
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
        text: `You walked down to ${h?.name ?? i.house}${i.why === 'wedding' ? ' for the wedding' : i.why === 'death' ? ' to sit with them' : i.why === 'birth' ? ' to see the child' : ''}.`,
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
      text: `The agha’s letter came up the valley with you: his barley in before the rains, his due of ${s.agha.due} kile by ${dateWords(s.agha.dueDay)}. The last kahya left in the night, in spring. His house above the mill stands empty.`,
      weight: 3,
    });
    note(s, {
      at: s.minute + 1,
      kind: 'weather',
      text: 'Cloud is building over the ridge. The old men say rain in two days.',
      weight: 2,
    });
  }
  // The first put-off reply opens insisting and visiting.
  if (
    s.notes.some((n) => n.kind === 'reply' && n.text.includes('put') && n.text.includes('off')) &&
    beat(g, 'insist')
  ) {
    reveal(g, 'insist');
    reveal(g, 'visit');
    note(s, {
      at: s.minute,
      kind: 'story',
      text: 'Osman the reeve, at your elbow: “Send word again and they’ll come, kahya. Or walk down and ask them yourself. Some houses only open the door to a face.”',
      words: 'Some houses only open the door to a face.',
      who: 'osman',
      weight: 2,
    });
  }
  if (day >= 1 && beat(g, 'reeve')) {
    note(s, {
      at: s.minute,
      kind: 'story',
      text: 'Osman says he knows every house in the lower lanes. His guesses are written beside yours now, in his hand.',
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
      text: `The threshing is well along. The ledger says what each house owes the agha. His rider comes on ${dateWords(s.agha.dueDay)} for ${s.agha.due} kile; the granary holds ${Math.round(s.agha.granary)}. Call the shares in, ease the ones who cannot, or send the reeve’s men.`,
      weight: 3,
    });
  }
  const leanHouse = s.households.some((h) => underSeal(s, h) && h.members.length && daysOfBread(s, h) < 30);
  if ((leanHouse || s.knocks.some((k) => k.what === 'grain' && k.at <= s.minute)) && beat(g, 'give')) {
    reveal(g, 'give');
    note(s, {
      at: s.minute,
      kind: 'story',
      text: 'Osman the reeve, low: “The granary is the agha’s, kahya, but the key is on your belt. What you give, the rider will count as missing.”',
      words: 'The key is on your belt.',
      who: 'osman',
      weight: 2,
    });
  }
  // Hunger in the lanes when the granary is low: the reeve says the agha can be written to.
  const lean = s.households.filter(
    (h) => underSeal(s, h) && h.members.length && daysOfBread(s, h) < 25,
  ).length;
  if (lean >= 2 && s.agha.granary < 60 && beat(g, 'borrow')) {
    reveal(g, 'borrow');
    note(s, {
      at: s.minute,
      kind: 'story',
      text: 'Osman the reeve came by at dusk. Two houses are scraping the jars, he said, and the granary is low. The agha lends, if you write to him, and his rider takes it back with a quarter more.',
      words: 'He lends. He never forgets that he lent.',
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
      text: 'A millwright from the city came up through the snow with the agha’s letter: a mill on the stream, if the valley carries the stone. Six hundred hours of backs, and the fields are idle till spring; stone slides on a sledge over frozen ground. When the mill turns, the agha will take his share in flour and ask forty kile less of the valley.',
      weight: 3,
    });
  }
  if (year === 2 && doy >= 160 && beat(g, 'upper')) {
    s.flags.upper = true;
    s.agha.due = dueFor(s);
    note(s, {
      at: s.minute,
      kind: 'letter',
      text: `The agha has bought the upper hamlet’s debts. Its six houses are under your seal from this harvest. You have never sat in any of them. The due rises to ${s.agha.due} kile.`,
      weight: 3,
    });
  }
  // The mill rising, in what can be seen at the stream.
  const MILL_SIGHTS: [number, string][] = [
    [0.25, 'The race is dug at the stream. Osman paced it out twice and pronounced it straight.'],
    [0.5, 'The mill walls are up to a man’s chest. Children dare each other to walk along them.'],
    [0.75, 'The millstones came up on the sledge, two days for the pair. The whole valley went to look.'],
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
      text: 'The mill turned for the first time. The children ran beside the race. The agha’s due falls by forty kile.',
      weight: 3,
    });
  }
  // Losing: the due short twice.
  if (s.agha.missed >= 2 && !s.flags.ended && s.minute >= s.agha.dueDay * DAY + 13 * HOUR) {
    s.flags.ended = 'dismissed';
    note(s, {
      at: s.minute,
      kind: 'letter',
      text: 'The rider came back with a second letter, sealed. The agha thanks you for your service. Another man will come up the valley before the snow.',
      weight: 3,
    });
  }
  if (day >= END_DAY && !s.flags.ended) {
    s.flags.ended = 'term';
    note(s, {
      at: s.minute,
      kind: 'story',
      text: 'The elders gathered at the konak, as they do at the end of a kahya’s term.',
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
  'Come back in the spring. Not as kahya.',
  'You were the agha’s man, and somehow ours too. I don’t know how you managed it.',
  'When the next one comes, I will tell him how it was done.',
  'There was bread in this house every winter you were here. I noticed.',
  'You never shouted. People remember a kahya who never shouted.',
  'If you pass this way again, there is a place at our cloth.',
];
/** Warm lines that only fit a kahya who came down this lane. */
const WARM_VISITED = [
  'When you knocked, we opened. Not every kahya can say that.',
  'You ate our bread like a neighbour. They don’t say that of many in this house.',
  'You sat on our step and asked about the goats. Nobody from the konak ever asked about the goats.',
  'The children still call the stool by the door the kahya’s stool.',
];
/** For a house the open hand fed. */
const OPEN_HAND = [
  'The agha lost some barley and we kept our children. I know which I would choose.',
  'Your sack came up our lane the winter it mattered. The agha can count it if he likes.',
  'They say you gave his grain away. They say it as if it were a bad thing.',
  'You were a poor kahya and a good neighbour. I would rather have the second.',
  'The rider wrote you down as short. We wrote you down as the one who came with a sack.',
  'Nobody in this house went to bed hungry while you held the key. Put that in the agha’s book.',
];
/** For a house that hardly knew you. */
const STRANGER = [
  'We hardly saw you. The crier did your asking.',
  'You never came down our lane. I couldn’t tell you what you were like.',
  'I would know the agha’s rider in the road sooner than you.',
  'Which one were you? Forgive me. There have been a few.',
  'We heard your name at the mill. That is all we had of you.',
  'If you came by, nobody told me.',
];
const PLAIN = [
  'You were here {years}. We will see what the next one is like.',
  'The barley came in. That is what a kahya is for.',
  'We had no quarrel with you. Write that down, it is rare.',
  'You came when you needed something. So did the last one.',
  'The young ones say you were fair. The young ones say a lot of things.',
  'You kept the agha’s book. Ours you never saw.',
  'Nothing to complain of. Nothing to sing about either.',
  'You did the work of the seal. I can’t say better or worse.',
  'The rider came and went, and so did you. The valley is still here.',
  'Ask me again in ten years. Kahyas look different from far away.',
  'We paid, you counted. That was most of it.',
  'You were not the worst. I’ve seen the worst.',
];
const COLD = [
  'We did what you asked. Don’t ask me to say more than that.',
  'Your book will say what it says. Ours says something else.',
  'The next one will hear about you before he unpacks.',
  'I have nothing to say to the agha’s man.',
  'You knew where our door was when the share was due.',
  'Go well. Go soon.',
  'We will be civil to the next one too. It costs nothing.',
  'I said my piece at the well. I won’t say it twice.',
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
    const deadName = starved?.name;
    const hard = !!starved?.hard || (s.stats.hard ?? []).includes(h.id);
    let words: string;
    if (deadName)
      words = hard
        ? `${deadName} died with nothing in the jar. You had the key to the granary. That is all I will say.`
        : `${deadName} died hungry, the winter you were here. I don’t say it was you. I don’t say it wasn’t.`;
    else if (worst && worst.at < 0 && (trust < 0.35 || !best))
      // A memory from before your term: the office, not you.
      words = `I remember ${worst.summary.replace(/^the kahya/, 'when the last kahya')}. It was the same seal.`;
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
      ? `The agha’s letter renews your seal and raises your stipend. He has never had the shares in so cleanly, he writes. ${hungryDead ? `He does not mention the ${hungryDead === 1 ? 'one who' : `${hungryDead} who`} died hungry. The elders did.` : 'The elders were quieter about it.'}`
      : s.flags.ended === 'dismissed' && given >= 40 && hungryDead === 0
        ? `The agha’s letter thanks you for your service, and ends it. Your term was to run three harvests; it ran short. He has worked out where ${Math.round(given)} kile of his barley went, he writes, and he is not a charity. Nobody in the valley died hungry while you held the seal. He does not mention that. The elders did.`
        : s.flags.ended !== 'dismissed' && given >= 40
          ? `The agha’s letter renews your seal${s.agha.missed ? ', for now' : ''}. It asks, twice, where ${Math.round(given)} kile of his barley went. In the margin you write the names of the houses that ate it.`
          : s.flags.ended === 'dismissed'
            ? 'The agha’s letter thanks you for your service, and ends it. Your term was to run three harvests; it ran short. Another man has the seal.'
            : s.agha.missed === 0 && meanTrust > 0.45
              ? 'The agha’s letter renews your seal for another term, and asks how you did it.'
              : s.agha.missed === 0
                ? 'The agha’s letter renews your seal. It says nothing about the valley.'
                : 'The agha’s letter renews your seal, for now. It mentions the year you were short.';
  return { elders, letter };
}

// ---------- saves and the export ----------

export interface SavedGame {
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

export function restoreState(json: ValleyState): ValleyState {
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
  `Volume ${roman(n + 1)}, ${dateWords(dayOfMinute(s.minute))} of year ${['one', 'two', 'three', 'four'][yearOf(dayOfMinute(s.minute)) - 1] ?? yearOf(dayOfMinute(s.minute))}`;

export function save(g: Game, n = 0): SavedGame {
  return {
    game: 'valley',
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

export function load(saved: SavedGame): Game {
  return { valley: restoreState(saved.state), inputs: structuredClone(saved.inputs) };
}

/** Rebuild a run from its seed and inputs alone. */
export function replay(seed: number, inputs: Input[], to: number): Game {
  const g = newGame(seed);
  step(g, to, inputs);
  return g;
}

export const seedFrom = (s: string) => mixSeed(strHash(s), 7) >>> 0;
export { type Ask, DAY, HOUR };
