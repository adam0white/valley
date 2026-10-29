/**
 * What a house says to the kahya, in the moment, when he does something to it: sits with them, sends grain, sends
 * the reeve's men, eases their share. One named person answers, in a voice drawn from their character, about what
 * is true for that house now: the jars, a birth or a death this season, and the host's current visit record.
 * HF supplies current traits and held trust. No private memory is reconstructed. Lines are composed from small
 * parts and a line is not said twice in one hamlet within a season.
 *
 * Covers: the visit, the gift, the seizure, easing. Does not cover: replies to asks (valley.ts `replyWords`), the
 * elders at the end (game.ts), conversation the player steers (deferred).
 */

import { DAY } from './calendar.ts';
import { ageYears, type Person } from './hf.ts';
import type { Household } from './people.ts';
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
  /** A wedding this season: a bride came into the house, or a daughter went out of it. */
  wed?: 'in' | 'out';
  left?: string;
  /** The hungriest other house in the hamlet, by name, for a full house to point at. */
  needy?: string;
}

type Pool = string[];

const OPEN: Record<Register, { warm: Pool; wary: Pool; cold: Pool }> = {
  blunt: {
    warm: [
      'Sit. You’re letting the cold in.',
      'You have come again. Sit down, then.',
      'Sit down, steward. You are safe here.',
    ],
    wary: ['If you’ve come for the share, say so.', 'Sit if you want. I have work.', 'What is it this time?'],
    cold: ['You can leave now.', 'Say what you came to say.', 'We have nothing for the landowner today.'],
  },
  anxious: {
    warm: [
      'Come in. Be careful of the step.',
      'Oh, steward, we didn’t know you were coming. Sit, please.',
      'Have some tea. Please do not refuse.',
    ],
    wary: [
      'Is something wrong? Has something happened?',
      'Steward, have you come for the share? We are trying to pay it.',
      'Sit. I’ll put the water on. Is it bad news?',
    ],
    cold: [
      'Please do not discuss this in front of the children.',
      'We have done nothing, steward.',
      'Did someone send you here?',
    ],
  },
  wry: {
    warm: [
      'The steward has come to our lane. The neighbours will think we’re rich.',
      'Sit. The tea is bad but it is hot.',
      'You have come to visit. Be careful of the dog. He may bark at you.',
    ],
    wary: [
      'The landowner’s man has come to our house. Should I hide the barley?',
      'Sit. We’ll pretend this is a social call.',
      'Have you come to ask about our health, steward, or the landowner’s?',
    ],
    cold: [
      'Have you come to count our spoons?',
      'Sit where I can see you.',
      'The last steward also used to visit us with a smile.',
    ],
  },
  plain: {
    warm: [
      'Welcome. Sit by the fire.',
      'Come in. You’ll eat with us.',
      'You’re welcome here, steward.',
      'You are here, steward! Sit down. Someone bring the cushion.',
      'There’s yogurt. You’ll have some.',
    ],
    wary: [
      'Come in. Sit.',
      'Steward, sit down if you’re staying.',
      'We weren’t expecting you. Sit.',
      'Sit down. The fire is low. I’ll add some wood.',
      'Steward, {spouse} is in the field.',
    ],
    cold: [
      'You are here, steward.',
      'You came, then.',
      'Sit, if you must.',
      'We’ve said what we have to say to the people at the residence.',
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
      'There’s barley in the house. We have more than we need, for once.',
      'The boys ate till they groaned last night. It has been a good year.',
      'We’ll sell a little at the market, if the landowner lets us.',
      'The jars are full. My mother says it won’t last. She says that every year.',
    ],
  },
  {
    min: 80,
    lines: [
      'Our food will last until spring if nobody falls ill.',
      'There is enough in the jar if we’re careful.',
      'We have enough for now. We will see whether it lasts through winter.',
      'We are not rich, but we are not hungry. That’s a good year here.',
      'If the snow comes late we’ll be fine.',
      'We have enough, God be thanked. We have no more than that.',
    ],
  },
  {
    min: 25,
    lines: [
      'We have less grain than I would like. We’re eating less at night.',
      'We’ll run short of food before spring. I know it already.',
      'Look in the jar if you want. I’d rather you didn’t.',
      'We’ve started mixing the husks from grain into the bread.',
      'Our youngest child asks for more food, but we cannot spare any more.',
      'I sold the copper pot. Don’t look at the shelf.',
    ],
  },
  {
    min: 0,
    lines: [
      'There’s nothing in the jar, steward. The children eat first.',
      'We’ve been eating what the neighbours bring.',
      'You can see for yourself. The jar is empty.',
      'We boiled the last of the seed. God forgive us.',
      'The children have stopped asking for food. That worries me more.',
      'I haven’t eaten since yesterday. Don’t tell {spouse} I told you.',
    ],
  },
];

const BORN = [
  'Come and see {child}. She has her grandmother’s scowl already.',
  '{child} hardly ever sleeps, so none of us get much sleep.',
  'Go on, hold {child}. Babies like strangers, though I do not know why.',
];
const BORN_BOY = [
  'Come and see {child}. He has his grandfather’s ears, poor thing.',
  '{child} hardly ever sleeps, so none of us get much sleep.',
  'Go on, hold {child}. You will not hurt him.',
];
const DIED = [
  'Thank you for coming. {dead} would have liked that you came.',
  'Sit with us a while. The house is too quiet without {dead}.',
  '{dead} always said the stewards never came down this lane.',
];
const WED = {
  in: [
    'The house is full of the new bride’s things. Mind the chest.',
    'We are still sweeping up after the wedding.',
  ],
  out: [
    'Our daughter married this month. The house is quieter. It is too quiet.',
    'Her frame for weaving cloth is still here. She’ll send for it.',
  ],
};
/** Why the kahya came, when he was asked: the first thing said is about that, not about him. */
const SCENE: Record<'wedding' | 'birth' | 'death', Pool> = {
  wedding: [
    'You came! Sit down and eat. The drum will play until morning.',
    'The steward has come to our wedding. My father will talk about this for a year.',
    'Sit with the men, steward. Eat first. We can talk afterward.',
  ],
  birth: [
    'Come in quietly. We are trying to let the baby sleep.',
    'You came to see the child. Sit down.',
    'God is generous. Come and look.',
  ],
  death: [
    'Thank you for coming. Sit with us.',
    'You came. Sit. There’s nothing to say, I know.',
    'Sit. The women are inside.',
  ],
};
const LEFT = [
  '{gone} went to the city. Don’t ask me about it.',
  'You’ll have heard {gone} left. There is work in the city, they say.',
];

const FIRST = ['You have come to our door. What do you need?'];

function pick(ctx: VoiceContext, p: Person, key: string, pool: Pool, k: number): string {
  const n = pool.length;
  const start = Math.floor(hashUnit(ctx.seed, DRAW.line, strHash(p.id), strHash(key), k) * n);
  const today = Math.floor(ctx.minute / DAY);
  for (let i = 0; i < n; i++) {
    const line = pool[(start + i) % n] ?? '';
    const key = rememberedLine(line);
    const was = ctx.said[key];
    if (was === undefined || today - was > 90) {
      ctx.said[key] = today;
      return line;
    }
  }
  // Every line in the pool was said this season: say nothing rather than repeat (the caller copes with '').
  return '';
}

/** "my wife" or "my husband", as the speaker would say it. */
function spoken(p: Person, line: string): string {
  const sp = p.life.sex === 'female' ? 'my husband' : 'my wife';
  return line.replace(/\{spouse\}/g, sp).replace(/\{Spouse\}/g, sp.charAt(0).toUpperCase() + sp.slice(1));
}

const band = (trust: number) => (trust > 0.6 ? 'warm' : trust < 0.35 ? 'cold' : 'wary');

/** Who answers for a house: the head, unless a mother of a newborn or a mourner has more to say. */
export function speakerOf(h: Household, people: (id: string) => Person | undefined): Person | undefined {
  const adults = h.members.map(people).filter((p): p is Person => !!p && p.body.alive && ageYears(p) >= 15);
  return adults[0];
}

/** Two or three sentences a house says when the kahya sits with them. */
/** A kahya who keeps coming back to the same hearth: the house notices, and so do the neighbours. */
const AGAIN: Pool = [
  'Have you come again, steward? People will talk about these visits.',
  'You were here the other day. Did you forget something?',
  'You have come back so soon. Sit down, then. The kettle hasn’t cooled.',
  'The neighbours are counting your visits, steward. So am I.',
  'If you visit any more often, we’ll have to cook a proper meal for you.',
  'You have visited twice in a week. Either you like our bread or you want something.',
];

export function visitWords(
  ctx: VoiceContext,
  p: Person,
  firstTime: boolean,
  why: 'call' | 'wedding' | 'birth' | 'death' = 'call',
  /** Days since the kahya last sat in this house, if he has. */
  since?: number,
): string {
  const r = registerOf(p);
  const opener =
    why !== 'call'
      ? SCENE[why]
      : since !== undefined && since < 10
        ? AGAIN
        : firstTime
          ? OPEN[r][band(ctx.trust)]
          : OPEN[r][band(ctx.trust)].filter((l) => !/expecting|didn’t know you were coming/.test(l));
  const parts: string[] = [pick(ctx, p, `open-${why}`, opener, 0) || 'You are here, steward.'];
  if (ctx.died) parts.push(pick(ctx, p, 'died', DIED, 1).replace('{dead}', ctx.died));
  else if (ctx.born) {
    const boy = /\bboy\b/.test(ctx.born);
    const name = ctx.born.replace(/ \((boy|girl)\)$/, '');
    parts.push(pick(ctx, p, 'born', boy ? BORN_BOY : BORN, 1).replace('{child}', name));
  } else if (ctx.wed) parts.push(pick(ctx, p, 'wed', WED[ctx.wed], 1));
  else if (ctx.left) parts.push(pick(ctx, p, 'left', LEFT, 1).replace('{gone}', ctx.left));
  const jars = JARS.find((j) => ctx.bread >= j.min) ?? JARS[3];
  if (jars && !ctx.died) parts.push(pick(ctx, p, `jars${jars.min}`, jars.lines, 2));
  if (firstTime) parts.push(pick(ctx, p, 'first', FIRST, 3));
  return spoken(p, parts.filter(Boolean).slice(0, 3).join(' '));
}

const GIFT: Record<string, Pool> = {
  need: [
    'God keep you, steward. The children will eat tonight.',
    'We’ll pay it back when we separate the grain from the cut barley. I swear it.',
    'I won’t forget who sent this.',
    'Tell the landowner we are grateful. Or thank God for us instead.',
  ],
  ok: [
    'That is kind of you. We’ll keep it for spring.',
    'We did not ask for grain, but we accept it.',
    'Thank you. I’ll keep it for later.',
  ],
  rich: [
    'We don’t need it, steward. {needy} does.',
    'Keep it for someone who’s hungry. We have enough.',
    'What do we want with the landowner’s grain? Our jars are full.',
  ],
};
const GIFT_BLUNT_NEED = [
  'It isn’t charity if we pay it back. We’ll pay it back.',
  'I accept it. Thank you. Please do not make a speech about it.',
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
    'Take it, then. Take the jars too, since you treat them as the landowner’s property.',
    'You’ll eat well tonight, steward.',
    'I’ll remember this. So will my sons.',
  ],
  anxious: [
    'Please leave some for the children.',
    'We would have brought the share to you.',
    'What will we eat? What will we eat now?',
  ],
  wry: [
    'So this is what the steward looks like when he’s working.',
    'Write it in your book. Write it neatly.',
    'At least the last steward asked first.',
  ],
  plain: [
    'You have our grain now.',
    'We would have paid if you had given us time.',
    'Everyone in the lane saw what happened. I hope you know that.',
  ],
};

export function seizeWords(ctx: VoiceContext, p: Person): string {
  return pick(ctx, p, 'seize', SEIZE[registerOf(p)], 0);
}

const EASED = [
  'You have halved our share. God bless you, steward. We can afford half.',
  'I won’t ask why us. I’ll just say thank you.',
  'The neighbours will talk about this. Let them talk.',
];
const EASED_LANE = [
  'People at the spring say: “Why did they get help instead of us? Their jars are no emptier than ours.”',
  'People at the coffeehouse say: “The steward has his favourites, then.”',
  'People at the spring say: “That is good. That house has had a bad year.”',
];

export function easeWords(ctx: VoiceContext, p: Person): string {
  return pick(ctx, p, 'eased', EASED, 0);
}
export function easeLaneWords(ctx: VoiceContext, p: Person, kind: number): string {
  return pick(ctx, p, 'eased-lane', EASED_LANE, kind);
}

/** What the steward can say at the hearth in the reply edition. Valley-authored words only; a saying never
 * changes a reply to a call. Insisting is still the only way to press someone. */
export type Saying = 'listen' | 'finish' | 'rain';
/** How the house stands on the open barley call, if it was asked: their own words decide the answer. */
export type CallStand = 'put-off' | 'coming' | 'none';
const LISTEN: Record<CallStand, Pool> = {
  'put-off': [
    'Then hear this: our own barley comes first. We will come when it is cut.',
    'Listen, then. If we leave our field, the rain takes it. That is all.',
    'You want to listen? Our barley is still standing. That is the whole story.',
  ],
  coming: [
    'We said we would come, and we will. You don’t need to sit here for that.',
    'We are already cutting for the landowner. Listen to the other houses.',
  ],
  none: [
    'There is not much to tell, steward. The work goes on.',
    'Listen, then. The children are well. The goat is not.',
    'You listen better than the last steward. That is not hard.',
  ],
};
const FINISH: Pool = [
  'That is fair. We will come once ours is in.',
  'Good. Then we can come with a clear head.',
  'We will remember that you let us finish.',
  'Thank you. Ours first, then the landowner’s.',
];
const FINISH_BLUNT: Pool = [
  'We would have done that anyway. But thank you for saying it.',
  'Fine. Our field first, then his.',
];
const RAIN: Record<CallStand, Pool> = {
  'put-off': [
    'We know. Our barley will be ruined too, and we eat ours.',
    'Rain falls on our field as well, steward. Ask us again when ours is cut.',
    'If you want us sooner, ask us yourself. Telling us the date changes nothing.',
  ],
  coming: ['We know. That is why we are cutting already.', 'We heard. We are working as fast as we can.'],
  none: ['Nobody asked us to cut it.', 'Then call us. We can only come if someone asks.'],
};

export function sayingWords(ctx: VoiceContext, p: Person, saying: Saying, stand: CallStand): string {
  if (saying === 'finish')
    return pick(ctx, p, 'say-finish', registerOf(p) === 'blunt' ? FINISH_BLUNT : FINISH, 0);
  return pick(ctx, p, `say-${saying}-${stand}`, saying === 'listen' ? LISTEN[stand] : RAIN[stand], 0);
}

/** How each register says yes to a call, by job; a paid call is answered as paid. */
export const ASSENT: Record<Register, { reap: Pool; share: Pool; carry: Pool; paid: Pool }> = {
  blunt: {
    reap: ['I’ll come. Don’t expect singing.', 'I’ll come before the rain.', 'I’ll be there at first light.'],
    share: ['Count it in front of me.', 'Here is our share. Write it down properly.'],
    carry: ['I agree.', 'I’ll carry stone this once.'],
    paid: [
      'You promise one of every eight bundles of cut barley as pay. I’ll count them.',
      'I’ll do the work if it is paid.',
    ],
  },
  anxious: {
    reap: [
      'Yes, yes, we’ll come. Is it going to rain?',
      'We’ll be there. Tell the landowner we came.',
      'I’ll come. I’ll bring the boy.',
    ],
    share: [
      'Here is our share. Is it enough? Please tell me it is enough.',
      'Here it is. Please write it down.',
    ],
    carry: ['I’ll carry. Is it far?', 'Yes, I’ll carry stone.'],
    paid: [
      'Will you pay us one of every eight bundles of cut barley? God bless you. We’ll come.',
      'I will come for a bundle of cut barley. Thank you.',
    ],
  },
  wry: {
    reap: [
      'I’ll work for the landowner, then. He’ll thank us personally, I’m sure.',
      'Someone has to cut the landowner’s barley. I wish we did not have to do it.',
      'I’ll come. Somebody has to sing.',
    ],
    share: [
      'There is our share. It will feed the landowner’s horses.',
      'Here is our share. Don’t spend it all at once.',
    ],
    carry: ['We could have a mill. I’ll carry stone.', 'I’ll carry stones for the landowner. Why not?'],
    paid: [
      'We will even be paid. Is the landowner unwell?',
      'We will receive one of every eight bundles of cut barley as pay. Things are changing.',
    ],
  },
  plain: {
    reap: ['I’ll come.', 'We’ll be there.', 'I’ll bring my own sickle.'],
    share: ['Here it is. Write it down.', 'Here is our share. We owe nothing now.'],
    carry: ['I’ll carry.', 'A mill would be good.'],
    paid: ['I’ll come if you pay me a bundle of cut barley.', 'That’s fair. We’ll be there.'],
  },
};

/** Saved no-repeat histories use the original line as their identity. */

const REMEMBERED_LINES: Record<string, string> = {
  'There was no smoke from the {fam} chimney this morning. {who} says the household is saving wood.':
    'There was no smoke from the {fam} chimney this morning. {who} says they are saving wood.',
  '{child} hardly ever sleeps, so none of us get much sleep.':
    '{child} doesn’t sleep. Nobody in this house sleeps.',
  'Come in quietly. We are trying to let the baby sleep.': 'Come in, quietly. She’s only just asleep.',

  'People played backgammon late at the coffeehouse. {who} lost and blamed the dice.':
    'The men sat late over backgammon at the coffeehouse. {who} lost, and blamed the dice.',
  'Her frame for weaving cloth is still here. She’ll send for it.':
    'Her loom is still here. She’ll send for it.',
  '{who} of {house} is digging the soil in the garden behind the house.':
    '{who} of {house} is turning the garden behind the house.',
  'The {fam} sheep are giving birth. {who} has not slept properly in a week.':
    'The {fam} ewes are lambing. {who} has not slept properly in a week.',
  'Someone heard a wolf above the {fam} sheep pen. {who} stayed awake with the dog.':
    'A wolf was heard above the {fam} fold. {who} sat up with the dog.',
  '{who} of {house} repaired the wooden frame that joins the oxen by lamplight.':
    '{who} of {house} mended a yoke by lamplight.',
  '{who} of {house} is weaving cloth beside the stove. You can hear the work from the lane.':
    '{who} of {house} has the loom up by the stove. You can hear it from the lane.',
  'Here is our share. Write it down properly.': 'There. Write it down properly.',
  'You have come again. Sit down, then.': 'You again. Sit, then.',
  'Sit down, steward. You are safe here.': 'Sit down, kahya. Nobody bites here.',
  'We have nothing for the landowner today.': 'We have nothing for the agha today.',
  'Come in. Be careful of the step.': 'Come in, come in, mind the step.',
  'Oh, steward, we didn’t know you were coming. Sit, please.':
    'Oh, kahya, we didn’t know you were coming. Sit, please.',
  'Have some tea. Please do not refuse.': 'You’ll take tea. Don’t say no.',
  'Steward, have you come for the share? We are trying to pay it.': 'Kahya. Is it the share? We are trying.',
  'Please do not discuss this in front of the children.':
    'Please. Whatever it is, not in front of the children.',
  'We have done nothing, steward.': 'We have done nothing, kahya.',
  'The steward has come to our lane. The neighbours will think we’re rich.':
    'The kahya in our lane. The neighbours will think we’re rich.',
  'You have come to visit. Be careful of the dog. He may bark at you.':
    'Look who walked down. Mind the dog, he has opinions.',
  'The landowner’s man has come to our house. Should I hide the barley?':
    'The agha’s man at our hearth. Should I hide the barley?',
  'Have you come to ask about our health, steward, or the landowner’s?':
    'Come for our health, kahya, or the agha’s?',
  'Have you come to count our spoons?': 'Come to count our spoons?',
  'You’re welcome here, steward.': 'You’re welcome here, kahya.',
  'Steward, sit down if you’re staying.': 'Kahya. Sit, if you’re staying.',
  'Sit down. The fire is low. I’ll add some wood.': 'Sit. The fire’s low, I’ll feed it.',
  'Steward, {spouse} is in the field.': 'Kahya. {Spouse} is in the field.',
  'You are here, steward.': 'Kahya.',
  'There’s barley in the house. We have more than we need, for once.':
    'There’s barley in the house. More than we need, for once.',
  'The boys ate till they groaned last night. It has been a good year.':
    'The boys ate till they groaned last night. A good year.',
  'We’ll sell a little at the market, if the landowner lets us.':
    'We’ll sell a little at the market, if the agha lets us.',
  'The jars are full. My mother says it won’t last. She says that every year.':
    'Full jars. My mother says it won’t last, she says that every year.',
  'There is enough in the jar if we’re careful.': 'Enough in the jar, if we’re careful.',
  'We have enough for now. We will see whether it lasts through winter.': 'We manage. The winter will tell.',
  'We are not rich, but we are not hungry. That’s a good year here.':
    'Not rich, not hungry. That’s a good year here.',
  'We have enough, God be thanked. We have no more than that.':
    'Enough, God be thanked. Not more than enough.',
  'Our youngest child asks for more food, but we cannot spare any more.':
    'The little one asks for more and there isn’t more.',
  'There’s nothing in the jar, steward. The children eat first.':
    'There’s nothing in the jar, kahya. The children eat first.',
  'You can see for yourself. The jar is empty.': 'You can see for yourself. The jar is scraped.',
  'The children have stopped asking for food. That worries me more.':
    'The children have stopped asking. That’s worse.',
  'Go on, hold {child}. Babies like strangers, though I do not know why.':
    'Hold {child}, go on. Babies like strangers, God knows why.',
  'Go on, hold {child}. You will not hurt him.': 'Hold {child}, go on. He won’t break.',
  '{dead} always said the stewards never came down this lane.':
    '{dead} always said the kahyas never came down this lane.',
  'Our daughter married this month. The house is quieter. It is too quiet.':
    'We gave our girl away this month. The house is quieter. Too quiet.',
  'You came! Sit down and eat. The drum will play until morning.':
    'You came! Sit, eat. The drum won’t stop till morning.',
  'The steward has come to our wedding. My father will talk about this for a year.':
    'The kahya at our wedding. My father will tell this for a year.',
  'Sit with the men, steward. Eat first. We can talk afterward.':
    'Sit with the men, kahya. Eat first, talk after.',
  'You came to see the child. Sit down.': 'You came to see the child. Sit, sit.',
  'We remember that {deed}. We have not forgotten.': 'We remember {deed}. We don’t forget that.',
  'You helped us when {deed}.': 'You did right by us when {deed}.',
  'I haven’t forgotten that {deed}.': 'I haven’t forgotten {deed}.',
  'We remember that {deed}. You should know that.': 'We remember {deed}. You should know that.',
  'The last steward took our ox. You have his job now.': 'The last kahya took our ox. You sit in his chair.',
  'No steward has sat in this house before.': 'No kahya has sat in this house before.',
  'Have you come again, steward? People will talk about these visits.': 'Again, kahya? People will talk.',
  'You have come back so soon. Sit down, then. The kettle hasn’t cooled.':
    'Back so soon. Sit, then. The kettle hasn’t cooled.',
  'The neighbours are counting your visits, steward. So am I.':
    'The neighbours are counting your visits, kahya. So am I.',
  'If you visit any more often, we’ll have to cook a proper meal for you.':
    'If you come any oftener we’ll have to feed you properly.',
  'You have visited twice in a week. Either you like our bread or you want something.':
    'Twice in a week. Either you like our bread or you want something.',
  'God keep you, steward. The children will eat tonight.':
    'God keep you, kahya. The children will eat tonight.',
  'We’ll pay it back when we separate the grain from the cut barley. I swear it.':
    'We’ll pay it back at the threshing. I swear it.',
  'Tell the landowner we are grateful. Or thank God for us instead.':
    'Tell the agha we are grateful. Or don’t. Tell God.',
  'Thank you. I’ll keep it for later.': 'Thank you. I’ll put it by.',
  'We don’t need it, steward. {needy} does.': 'We don’t need it, kahya. {needy} does.',
  'What do we want with the landowner’s grain? Our jars are full.':
    'What do we want with the agha’s grain? Our jars are full.',
  'I accept it. Thank you. Please do not make a speech about it.':
    'Fine. Thank you. Don’t make a speech of it.',
  'Take it, then. Take the jars too, since you treat them as the landowner’s property.':
    'Take it, then. Take the jars too, they’re the agha’s as well.',
  'You’ll eat well tonight, steward.': 'You’ll eat well tonight, kahya.',
  'Please leave some for the children.': 'Please, leave some for the children. Please.',
  'We would have brought the share to you.': 'We would have brought it. We would have.',
  'So this is what the steward looks like when he’s working.':
    'So this is what the kahya looks like when he’s working.',
  'At least the last steward asked first.': 'The last one at least asked first.',
  'You have our grain now.': 'There. Now you have it.',
  'We would have paid if you had given us time.': 'We would have paid, given time.',
  'Everyone in the lane saw what happened. I hope you know that.':
    'The whole lane saw. I hope you know that.',
  'You have halved our share. God bless you, steward. We can afford half.':
    'Half. God bless you, kahya. Half we can carry.',
  'The neighbours will talk about this. Let them talk.': 'The neighbours will talk. Let them.',
  'People at the spring say: “Why did they get help instead of us? Their jars are no emptier than ours.”':
    'Talk at the spring: “Why them and not us? Their jars are no emptier than ours.”',
  'People at the coffeehouse say: “The steward has his favourites, then.”':
    'Talk at the coffeehouse: “The kahya has his favourites, then.”',
  'People at the spring say: “That is good. That house has had a bad year.”':
    'Talk at the spring: “Good. That house has had a bad year.”',
  'I’ll come before the rain.': 'Fine. Before the rain.',
  'I agree.': 'Fine.',
  'I’ll carry stone this once.': 'I’ll carry. Once.',
  'You promise one of every eight bundles of cut barley as pay. I’ll count them.':
    'A sheaf in eight. I’ll count them.',
  'I’ll do the work if it is paid.': 'Paid work. That I’ll do.',
  'We’ll be there. Tell the landowner we came.': 'We’ll be there. Tell the agha we came.',
  'Here is our share. Is it enough? Please tell me it is enough.': 'Here. Is it enough? Tell me it’s enough.',
  'Yes, I’ll carry stone.': 'Yes, of course.',
  'Will you pay us one of every eight bundles of cut barley? God bless you. We’ll come.':
    'A sheaf in eight? God bless you. We’ll come.',
  'I will come for a bundle of cut barley. Thank you.': 'For a sheaf, yes. Thank you.',
  'I’ll work for the landowner, then. He’ll thank us personally, I’m sure.':
    'For the agha, then. He’ll thank us personally, I’m sure.',
  'Someone has to cut the landowner’s barley. I wish we did not have to do it.':
    'The agha’s barley won’t cut itself. More’s the pity.',
  'There is our share. It will feed the landowner’s horses.': 'There. Our gift to the agha’s horses.',
  'Here is our share. Don’t spend it all at once.': 'Here. Don’t spend it all at once.',
  'We could have a mill. I’ll carry stone.': 'A mill. Imagine. I’ll carry.',
  'I’ll carry stones for the landowner. Why not?': 'Stones for the agha. Why not.',
  'We will even be paid. Is the landowner unwell?': 'Paid, even. Is the agha unwell?',
  'We will receive one of every eight bundles of cut barley as pay. Things are changing.':
    'A sheaf in eight. The world is turning.',
  'Here is our share. We owe nothing now.': 'There. We owe nothing.',
  'I’ll come if you pay me a bundle of cut barley.': 'For a sheaf, I’ll come.',
  'I’ll come because you insist.': 'Since you insist.',
  'I can bring half now. I’ll bring the rest when I can.': 'Half now. The rest when I can.',
  'Take half. We have people to feed.': 'Take half. We have mouths.',
  'We must cut our own barley first. Then we can cut the landowner’s.':
    'Our own barley first. Then the agha’s.',
  'We must finish our own field first. It’s ripe too.': 'After our own field. It’s ripe too.',
  'My barley will rot, steward. I must cut it first.': 'My barley will rot, kahya. After.',
  'I cannot bring it yet. Winter is long.': 'Not yet. Winter is long.',
  'Who will feed my family while I cut his barley?': 'Who feeds mine while I cut his?',
  'I will not come just because you ask. I will not come today.': 'Not on your word. Not today.',
  'The last steward said that too.': 'The last kahya said that too.',
  'No. I will not do it for you.': 'No. Not for you.',
  'I can’t work. My back hurts too much.': 'I can’t. My back’s gone.',
  'I am too tired to work.': 'I’m dead on my feet.',
  'There’s no bread in the house, steward.': 'There’s no bread in the house, kahya.',
  'You can leave now.': 'You know where the door is.',
  'The last steward also used to visit us with a smile.': 'The last one used to come like this too, smiling.',
  'You are here, steward! Sit down. Someone bring the cushion.': 'Kahya! Sit, sit. Bring the cushion.',
  'We’ve said what we have to say to the people at the residence.':
    'We’ve said what we have to say to the konak.',
  'Our food will last until spring if nobody falls ill.': 'We’ll get to the spring if nobody falls ill.',
  'We have less grain than I would like. We’re eating less at night.':
    'The jar is lower than I like. We’re eating less at night.',
  'We’ll run short of food before spring. I know it already.':
    'We’ll be short before the spring. I know it already.',
  'We’ve started mixing the husks from grain into the bread.': 'We’ve started mixing chaff into the bread.',
  'We did not ask for grain, but we accept it.': 'We weren’t asking, but we won’t say no.',
  'That is kind of you. We’ll keep it for spring.': 'That’s kind. We’ll keep it for the spring.',
  'I’ll do as you say, steward.': 'As you say, kahya.',
  'We barely have enough food for ourselves, steward.': 'We’ve barely enough, kahya.',
  'I already did what you asked once, steward. That was enough.': 'Once was enough, kahya.',
  'I came when you insisted. Look what happened to me.': 'I came when you pushed. Look what it got me.',
  'I have no strength left today.': 'I’ve nothing left in me today.',
  'How can I work without food? Let me eat first.': 'On an empty stomach? Let me eat.',
  'Snow covers the upper lanes. The {fam} children slid down the snow on a tray until dark.':
    'Snow on the upper lanes. The {fam} children were out on a tray until dark.',
  'People are washing clothes at the spring. {who} of {house} brought back all the news.':
    'Washing day at the spring. {who} of {house} brought back all the news.',
  'It was too hot to work at noon. {who} slept in the shade of the {fam} walnut.':
    'Too hot to work at noon. {who} slept in the shade of the {fam} walnut.',
  'People baked bread at the {fam} oven today. The smell spread down the lane.':
    'Bread baked at the {fam} oven today; the smell went all down the lane.',
  '{who} walked to the mosque through the snow for the night prayer, as on most evenings.':
    '{who} walked to the mosque through the snow for the night prayer, as most evenings.',
  '{who} of {house} took a donkey loaded with grapes down to the pot for making grape syrup.':
    '{who} of {house} took a donkey of grapes down to the pekmez cauldron.',
  'The {fam} roof is getting a new layer of mud before the rains. {who} is on the roof, shouting down.':
    'The {fam} roof is being re-mudded before the rains. {who} is on it, shouting down.',
};

export function rememberedLine(line: string): string {
  return REMEMBERED_LINES[line] ?? line;
}
