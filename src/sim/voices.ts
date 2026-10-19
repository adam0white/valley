/**
 * What a house says to the kahya, in the moment, when he does something to it: sits with them, sends grain, sends
 * the reeve's men, eases their share. One named person answers, in a voice drawn from their character, about what
 * is true for that house now: the jars, a birth or a death this season, and the strongest thing they remember the
 * kahya doing (read from HF memory without recalling, so reading changes nothing). Lines are composed from small
 * parts and a line is not said twice in one hamlet within a season.
 *
 * Covers: the visit, the gift, the seizure, easing. Does not cover: replies to asks (valley.ts `replyWords`), the
 * elders at the end (game.ts), conversation the player steers (deferred).
 */
import { ageYears, type Episode, type Person } from '@adam0white/human-framework';
import { DAY } from './calendar.ts';
import type { Household } from './people.ts';
import { KAHYA } from './people.ts';
import { DRAW, hashUnit, strHash } from './rng.ts';

/** How a person talks: a register read from their traits. */
type Register = 'blunt' | 'anxious' | 'wry' | 'plain';

export function registerOf(p: Person): Register {
  const t = p.traits;
  if (t.agreeableness < 0.38) return 'blunt';
  if (t.emotionality > 0.66) return 'anxious';
  if (t.openness > 0.62) return 'wry';
  return 'plain';
}

/** The kahya's own deed as the person remembers it, in the second person. */
export const youDid = (summary: string) =>
  summary.replace(/^the kahya’s /, 'your ').replace(/^the kahya /, 'you ');

export interface VoiceContext {
  seed: number;
  minute: number;
  /** Lines already said in the valley, with the day: no repeat within a season. */
  said: Record<string, number>;
  /** How many days of bread the house has (world truth; the speaker knows their own jars). */
  bread: number;
  trust: number;
  /** This season in the house: a child born, someone died, a wedding, someone gone to the city. */
  born?: string;
  died?: string;
  wed?: boolean;
  left?: string;
  /** The hungriest other house in the hamlet, by name, for a full house to point at. */
  needy?: string;
}

type Pool = string[];

const OPEN: Record<Register, { warm: Pool; wary: Pool; cold: Pool }> = {
  blunt: {
    warm: [
      'Sit. You’re letting the cold in.',
      'You again. Sit, then.',
      'Sit down, kahya. Nobody bites here.',
    ],
    wary: ['If you’ve come for the share, say so.', 'Sit if you want. I have work.', 'What is it this time?'],
    cold: ['You know where the door is.', 'Say what you came to say.', 'We have nothing for the agha today.'],
  },
  anxious: {
    warm: [
      'Come in, come in, mind the step.',
      'Oh, kahya, we didn’t know you were coming. Sit, please.',
      'You’ll take tea. Don’t say no.',
    ],
    wary: [
      'Is something wrong? Has something happened?',
      'Kahya. Is it the share? We are trying.',
      'Sit. I’ll put the water on. Is it bad news?',
    ],
    cold: [
      'Please. Whatever it is, not in front of the children.',
      'We have done nothing, kahya.',
      'Did someone send you here?',
    ],
  },
  wry: {
    warm: [
      'The kahya in our lane. The neighbours will think we’re rich.',
      'Sit. The tea is bad but it is hot.',
      'Look who walked down. Mind the dog, he has opinions.',
    ],
    wary: [
      'The agha’s man at our hearth. Should I hide the barley?',
      'Sit. We’ll pretend this is a social call.',
      'Come for our health, kahya, or the agha’s?',
    ],
    cold: [
      'Come to count our spoons?',
      'Sit where I can see you.',
      'The last one used to come like this too, smiling.',
    ],
  },
  plain: {
    warm: [
      'Welcome. Sit by the fire.',
      'Come in. You’ll eat with us.',
      'You’re welcome here, kahya.',
      'Kahya! Sit, sit. Bring the cushion.',
      'There’s yogurt. You’ll have some.',
    ],
    wary: [
      'Come in. Sit.',
      'Kahya. Sit, if you’re staying.',
      'We weren’t expecting you. Sit.',
      'Sit. The fire’s low, I’ll feed it.',
      'Kahya. My husband is in the field.',
    ],
    cold: [
      'Kahya.',
      'You came, then.',
      'Sit, if you must.',
      'We’ve said what we have to say to the konak.',
      'Stand, then. We’re busy.',
    ],
  },
};

const JARS: { min: number; lines: Pool }[] = [
  {
    min: 200,
    lines: [
      'The jars are full this year, thank God. We’ve no complaint.',
      'We had a good year. I won’t pretend otherwise.',
      'There’s barley in the house. More than we need, for once.',
      'The boys ate till they groaned last night. A good year.',
      'We’ll sell a little at the market, if the agha lets us.',
      'Full jars. My mother says it won’t last, she says that every year.',
    ],
  },
  {
    min: 80,
    lines: [
      'We’ll get to the spring if nobody falls ill.',
      'Enough in the jar, if we’re careful.',
      'We manage. The winter will tell.',
      'Not rich, not hungry. That’s a good year here.',
      'If the snow comes late we’ll be fine.',
      'Enough, God be thanked. Not more than enough.',
    ],
  },
  {
    min: 25,
    lines: [
      'The jar is lower than I like. We’re eating less at night.',
      'We’ll be short before the spring. I know it already.',
      'Look in the jar if you want. I’d rather you didn’t.',
      'We’ve started mixing chaff into the bread.',
      'The little one asks for more and there isn’t more.',
      'I sold the copper pot. Don’t look at the shelf.',
    ],
  },
  {
    min: 0,
    lines: [
      'There’s nothing in the jar, kahya. The children eat first.',
      'We’ve been eating what the neighbours bring.',
      'You can see for yourself. The jar is scraped.',
      'We boiled the last of the seed. God forgive us.',
      'The children have stopped asking. That’s worse.',
      'I haven’t eaten since yesterday. Don’t tell my wife I told you.',
    ],
  },
];

const BORN = [
  'Come and see {child}. She has her grandmother’s scowl already.',
  '{child} doesn’t sleep. Nobody in this house sleeps.',
  'Hold {child}, go on. Babies like strangers, God knows why.',
];
const BORN_BOY = [
  'Come and see {child}. He has his grandfather’s ears, poor thing.',
  '{child} doesn’t sleep. Nobody in this house sleeps.',
  'Hold {child}, go on. He won’t break.',
];
const DIED = [
  'Thank you for coming. {dead} would have liked that you came.',
  'Sit with us a while. The house is too quiet without {dead}.',
  '{dead} always said the kahyas never came down this lane.',
];
const WED = [
  'The house is full of the new bride’s things. Mind the chest.',
  'We are still sweeping up after the wedding.',
];
const LEFT = [
  '{gone} went to the city. Don’t ask me about it.',
  'You’ll have heard {gone} left. There is work in the city, they say.',
];

const GOOD = [
  'We remember {deed}. We don’t forget that.',
  'My wife still talks about how {deed}.',
  'You did right by us when {deed}.',
];
const BAD = [
  'I haven’t forgotten {deed}.',
  'We remember {deed}. You should know that.',
  'It was hard, when {deed}.',
];
const OFFICE = [
  'The last kahya took our ox. You sit in his chair.',
  'The last one smiled like that too, and then he took the ox.',
];
const FIRST = [
  'No kahya has sat in this house before.',
  'Nobody from the konak has come down here in years.',
  'You’re the first of them to come to the door without wanting something. Or are you?',
];

function pick(ctx: VoiceContext, p: Person, key: string, pool: Pool, k: number): string {
  const n = pool.length;
  const start = Math.floor(hashUnit(ctx.seed, DRAW.line, strHash(p.id), strHash(key), k) * n);
  const today = Math.floor(ctx.minute / DAY);
  for (let i = 0; i < n; i++) {
    const line = pool[(start + i) % n] ?? '';
    const was = ctx.said[line];
    if (was === undefined || today - was > 90) {
      ctx.said[line] = today;
      return line;
    }
  }
  return pool[start] ?? '';
}

/** The most salient thing this person remembers the kahya doing (pure read of HF memory, no recall). */
function strongestDeed(p: Person, now: number): Episode | undefined {
  let best: Episode | undefined;
  let score = 0;
  for (const e of p.memory.episodes) {
    if (e.actorId !== KAHYA || now - e.at > 240 * DAY) continue;
    const sc = Math.abs(e.valence) * e.salience;
    if (sc > score) {
      score = sc;
      best = e;
    }
  }
  return score > 0.15 ? best : undefined;
}

const band = (trust: number) => (trust > 0.6 ? 'warm' : trust < 0.35 ? 'cold' : 'wary');

/** Who answers for a house: the head, unless a mother of a newborn or a mourner has more to say. */
export function speakerOf(h: Household, people: (id: string) => Person | undefined): Person | undefined {
  const adults = h.members.map(people).filter((p): p is Person => !!p && p.body.alive && ageYears(p) >= 15);
  return adults[0];
}

/** Two or three sentences a house says when the kahya sits with them. */
export function visitWords(ctx: VoiceContext, p: Person, h: Household, firstTime: boolean): string {
  const r = registerOf(p);
  const parts: string[] = [pick(ctx, p, 'open', OPEN[r][band(ctx.trust)], 0)];
  if (ctx.died) parts.push(pick(ctx, p, 'died', DIED, 1).replace('{dead}', ctx.died));
  else if (ctx.born) {
    const boy = /\bboy\b/.test(ctx.born);
    const name = ctx.born.replace(/ \((boy|girl)\)$/, '');
    parts.push(pick(ctx, p, 'born', boy ? BORN_BOY : BORN, 1).replace('{child}', name));
  } else if (ctx.wed) parts.push(pick(ctx, p, 'wed', WED, 1));
  else if (ctx.left) parts.push(pick(ctx, p, 'left', LEFT, 1).replace('{gone}', ctx.left));
  const jars = JARS.find((j) => ctx.bread >= j.min) ?? JARS[3];
  if (jars && !ctx.died) parts.push(pick(ctx, p, `jars${jars.min}`, jars.lines, 2));
  const deed = strongestDeed(p, ctx.minute);
  if (deed && deed.at >= 0)
    parts.push(
      pick(ctx, p, deed.valence > 0 ? 'good' : 'bad', deed.valence > 0 ? GOOD : BAD, 3).replace(
        '{deed}',
        youDid(deed.summary),
      ),
    );
  else if (deed && deed.at < 0) parts.push(pick(ctx, p, 'office', OFFICE, 3));
  else if (firstTime) parts.push(pick(ctx, p, 'first', FIRST, 3));
  return parts.slice(0, 3).join(' ');
}

const GIFT: Record<string, Pool> = {
  need: [
    'God keep you, kahya. The children will eat tonight.',
    'We’ll pay it back at the threshing. I swear it.',
    'I won’t forget who sent this.',
    'Tell the agha we are grateful. Or don’t. Tell God.',
  ],
  ok: [
    'That’s kind. We’ll keep it for the spring.',
    'We weren’t asking, but we won’t say no.',
    'Thank you. I’ll put it by.',
  ],
  rich: [
    'We don’t need it, kahya. {needy} does.',
    'Keep it for someone who’s hungry. We have enough.',
    'What do we want with the agha’s grain? Our jars are full.',
  ],
};
const GIFT_BLUNT_NEED = [
  'It isn’t charity if we pay it back. We’ll pay it back.',
  'Fine. Thank you. Don’t make a speech of it.',
];

export function giftWords(ctx: VoiceContext, p: Person): string {
  const pool =
    ctx.bread >= 150
      ? GIFT.rich
      : ctx.bread < 30
        ? registerOf(p) === 'blunt'
          ? GIFT_BLUNT_NEED
          : GIFT.need
        : GIFT.ok;
  return pick(ctx, p, 'gift', pool ?? [], 0).replace('{needy}', ctx.needy ?? 'Someone down the lane');
}

const SEIZE: Record<Register, Pool> = {
  blunt: [
    'Take it, then. Take the jars too, they’re the agha’s as well.',
    'You’ll eat well tonight, kahya.',
    'I’ll remember this. So will my sons.',
  ],
  anxious: [
    'Please, leave some for the children. Please.',
    'We would have brought it. We would have.',
    'What will we eat? What will we eat now?',
  ],
  wry: [
    'So this is what the kahya looks like when he’s working.',
    'Write it in your book. Write it neatly.',
    'The last one at least asked first.',
  ],
  plain: [
    'There. Now you have it.',
    'We would have paid, given time.',
    'The whole lane saw. I hope you know that.',
  ],
};

export function seizeWords(ctx: VoiceContext, p: Person): string {
  return pick(ctx, p, 'seize', SEIZE[registerOf(p)], 0);
}

const EASED = [
  'Half. God bless you, kahya. Half we can carry.',
  'I won’t ask why us. I’ll just say thank you.',
  'The neighbours will talk. Let them.',
];
const EASED_LANE = [
  'Talk at the spring: “Why them and not us? Their jars are no emptier than ours.”',
  'Talk at the coffeehouse: “The kahya has his favourites, then.”',
  'Talk at the spring: “Good. That house has had a bad year.”',
];

export function easeWords(ctx: VoiceContext, p: Person): string {
  return pick(ctx, p, 'eased', EASED, 0);
}
export function easeLaneWords(ctx: VoiceContext, p: Person, kind: number): string {
  return pick(ctx, p, 'eased-lane', EASED_LANE, kind);
}

/** How each register says yes to a call, by job; a paid call is answered as paid. */
export const ASSENT: Record<Register, { reap: Pool; share: Pool; carry: Pool; paid: Pool }> = {
  blunt: {
    reap: ['I’ll come. Don’t expect singing.', 'Fine. Before the rain.', 'I’ll be there at first light.'],
    share: ['Count it in front of me.', 'There. Write it down properly.'],
    carry: ['Fine.', 'I’ll carry. Once.'],
    paid: ['A sheaf in eight. I’ll count them.', 'Paid work. That I’ll do.'],
  },
  anxious: {
    reap: [
      'Yes, yes, we’ll come. Is it going to rain?',
      'We’ll be there. Tell the agha we came.',
      'I’ll come. I’ll bring the boy.',
    ],
    share: ['Here. Is it enough? Tell me it’s enough.', 'Here it is. Please write it down.'],
    carry: ['I’ll carry. Is it far?', 'Yes, of course.'],
    paid: ['A sheaf in eight? God bless you. We’ll come.', 'For a sheaf, yes. Thank you.'],
  },
  wry: {
    reap: [
      'For the agha, then. He’ll thank us personally, I’m sure.',
      'The agha’s barley won’t cut itself. More’s the pity.',
      'I’ll come. Somebody has to sing.',
    ],
    share: ['There. Our gift to the agha’s horses.', 'Here. Don’t spend it all at once.'],
    carry: ['A mill. Imagine. I’ll carry.', 'Stones for the agha. Why not.'],
    paid: ['Paid, even. Is the agha unwell?', 'A sheaf in eight. The world is turning.'],
  },
  plain: {
    reap: ['I’ll come.', 'We’ll be there.', 'After the dew. I’ll come.'],
    share: ['Here it is. Write it down.', 'There. We owe nothing.'],
    carry: ['I’ll carry.', 'A mill would be good.'],
    paid: ['For a sheaf, I’ll come.', 'That’s fair. We’ll be there.'],
  },
};
