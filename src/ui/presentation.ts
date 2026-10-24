/** Read-only English copy for the steward's notebook. Saved words remain untouched. */
import { DAY, dateEnglish, dayOfMinute, doyOf, seasonOf, yearOf } from '../sim/calendar.ts';
import { END_DAY } from '../sim/game.ts';
import type { Household } from '../sim/people.ts';
import { type Job, nextRiderDay, shareOwed, underSeal, V, type ValleyState } from '../sim/valley.ts';

const DISPLAY_COPY: Record<string, string> = {
  'Kahya. Sit, if you’re staying.': 'Kahya, sit down if you’re staying.',
  'Kahya. {Spouse} is in the field.': 'Kahya, {Spouse} is in the field.',
  'We would have paid, given time.': 'We would have paid if you had given us time.',
  'Come and see {child}. He has his grandfather’s ears, poor thing.':
    'Come and see {child}. He has his grandfather’s ears, poor thing.',
  'Not on your word. Not today.': 'I will not come just because you ask. I will not come today.',
  'No. Not for you.': 'No. I will not do it for you.',
  'Not yet. Winter is long.': 'I cannot bring it yet. Winter is long.',
  'Who feeds mine while I cut his?': 'Who will feed my family while I cut his barley?',
  'For a sheaf, yes. Thank you.': 'I will come for a sheaf. Thank you.',
  'After the threshing.': 'I can come after the threshing.',
  'There. We owe nothing.': 'Here is our share. We owe nothing now.',
  'The world is turning.': 'Things are changing.',
  'The whole lane saw.': 'Everyone in the lane saw what happened.',
  'You did the work of the seal.': 'You did the work of the kahya.',
  'Nobody bites here.': 'You are safe here.',
  'Look who walked down. Mind the dog, he has opinions.':
    'You have come to visit. Be careful of the dog. He may bark at you.',
  'I’ll put it by.': 'I’ll keep it for later.',
  'Too quiet.': 'It is too quiet.',
  'The reeve, at the granary door:': 'The reeve speaks at the granary door:',

  'The reeve’s house: whitewashed, the only one with glass in a window.':
    'The reeve lives in this whitewashed house. It is the only house with a glass window.',
  'Osman’s brother’s house. Three boys’ shirts on the line.':
    'Osman’s brother lives here. Three boys’ shirts hang on the line.',
  'The shepherd’s house at the edge, a dog on a chain, the flock up on the yayla.':
    'The shepherd lives at the edge of the hamlet. A dog is chained outside. The flock is on the yayla.',
  'A young house, roof half-mended. A baby crying most evenings.':
    'A young family lives here. The roof is partly repaired. A baby cries most evenings.',
  'The smithy. The old man still swings the hammer; his son does the rest.':
    'This is the smithy. The old man still swings the hammer. His son does the rest.',
  'The well-digger’s house. Two daughters, and the whole lane knows it.':
    'The well-digger lives here with his two daughters. Everyone in the lane knows them.',
  'Up the slope. The son is at the coffeehouse more than at the plough.':
    'This house is up the slope. The son spends more time at the coffeehouse than working in the fields.',
  'Highest house in the valley; they come down only for the mill.':
    'This is the highest house in the valley. The family comes down only for the mill.',
  'An old walnut over the door, and a feud with someone below.':
    'An old walnut tree grows over the door. This family has a feud with someone in the lower hamlet.',
  'By the upper spring. The women of the upper lanes meet here.':
    'This house is by the upper spring. The women of the upper lanes meet here.',
  'Tall men, all of them, and a mother who decides.':
    'All the men in this house are tall. Their mother makes the decisions.',
  'New roof tiles. Someone sends money from the city.':
    'The roof has new tiles. Someone sends money from the city.',
  'You again. Sit, then.': 'You have come again. Sit down, then.',
  'Kahya. Is it the share? We are trying.': 'Kahya, have you come for the share? We are trying to pay it.',
  'Please. Whatever it is, not in front of the children.':
    'Please do not discuss this in front of the children.',
  'The kahya in our lane. The neighbours will think we’re rich.':
    'The kahya has come to our lane. The neighbours will think we’re rich.',
  'The agha’s man at our hearth. Should I hide the barley?':
    'The agha’s man has come to our house. Should I hide the barley?',
  'Come for our health, kahya, or the agha’s?':
    'Have you come to ask about our health, kahya, or the agha’s?',
  'Come to count our spoons?': 'Have you come to count our spoons?',
  'Kahya.': 'You are here, kahya.',
  'There’s barley in the house. More than we need, for once.':
    'There’s barley in the house. We have more than we need, for once.',
  'The boys ate till they groaned last night. A good year.':
    'The boys ate till they groaned last night. It has been a good year.',
  'Full jars. My mother says it won’t last, she says that every year.':
    'The jars are full. My mother says it won’t last. She says that every year.',
  'Enough in the jar, if we’re careful.': 'There is enough in the jar if we’re careful.',
  'Not rich, not hungry. That’s a good year here.':
    'We are not rich, but we are not hungry. That’s a good year here.',
  'Enough, God be thanked. Not more than enough.':
    'We have enough, God be thanked. We have no more than that.',
  'We gave our girl away this month. The house is quieter. Too quiet.':
    'Our daughter married this month. The house is quieter. It is too quiet.',
  'The kahya at our wedding. My father will tell this for a year.':
    'The kahya has come to our wedding. My father will talk about this for a year.',
  'Back so soon. Sit, then. The kettle hasn’t cooled.':
    'You have come back so soon. Sit down, then. The kettle hasn’t cooled.',
  'Twice in a week. Either you like our bread or you want something.':
    'You have visited twice in a week. Either you like our bread or you want something.',
  'Half. God bless you, kahya. Half we can carry.':
    'You have halved our share. God bless you, kahya. We can afford half.',
  'Fine. Before the rain.': 'I’ll come before the rain.',
  'I’ll carry. Once.': 'I’ll carry stone this once.',
  'A sheaf in eight. I’ll count them.': 'You promise a sheaf in eight. I’ll count them.',
  'Paid work. That I’ll do.': 'I’ll do the work if it is paid.',
  'A mill. Imagine. I’ll carry.': 'We could have a mill. I’ll carry stone.',
  'Stones for the agha. Why not.': 'I’ll carry stones for the agha. Why not?',
  'Paid, even. Is the agha unwell?': 'We will even be paid. Is the agha unwell?',
  'A sheaf in eight. The world is turning.': 'We will receive a sheaf in eight. Things are changing.',
  'For the agha, then. He’ll thank us personally, I’m sure.':
    'I’ll work for the agha, then. He’ll thank us personally, I’m sure.',
  'There. Our gift to the agha’s horses.': 'There is our share. It will feed the agha’s horses.',
  'Since you insist.': 'I’ll come because you insist.',
  'Half now. The rest when I can.': 'I can bring half now. I’ll bring the rest when I can.',
  'Take half. We have mouths.': 'Take half. We have people to feed.',
  'Our own barley first. Then the agha’s.': 'We must cut our own barley first. Then we can cut the agha’s.',
  'After our own field. It’s ripe too.': 'We must finish our own field first. It’s ripe too.',
  'My barley will rot, kahya. After.': 'My barley will rot, kahya. I must cut it first.',
  'I’m dead on my feet.': 'I am too tired to work.',
  'I can’t. My back’s gone.': 'I can’t work. My back hurts too much.',
  'Come back in the spring. Not as kahya.': 'Come back in the spring, but do not come as kahya.',
  'Nothing to complain of. Nothing to sing about either.':
    'I have nothing to complain about. I have nothing to praise either.',
  'The rain will not wait.': 'Rain can damage the barley before it is cut.',
  'The lanes will see.': 'The neighbours will notice.',
  'No new word from this house.': 'There is no new reply from this house.',
  'The key is on your belt.': 'You control who receives grain from the granary.',
  'Some houses only open the door to a face.': 'Some households will only listen if you visit them.',
  'Six hundred hours of backs': 'The work needs six hundred hours of labour',
  'Winter will bring hungry doors': 'People will ask for grain in winter',
  'Watch for hungry doors': 'Watch for people who need grain',
  'watch for hungry doors': 'watch for people who need grain',
  'Keep grain for hungry doors': 'Keep grain for people who need it',
  'keep grain for hungry doors': 'keep grain for people who need it',
  'The upper hamlet comes under your seal': 'You gain authority over the upper hamlet',
  'This house is outside your seal': 'You have no authority over this house',
  'Your seal reaches the houses through the crier first.':
    'At first, you can only send requests through the crier.',
};

const DISPLAY_REPLACEMENTS = Object.entries(DISPLAY_COPY).sort(([a], [b]) => b.length - a.length);

const ENGLISH: Record<string, string> = {
  ocak: 'January',
  şubat: 'February',
  mart: 'March',
  nisan: 'April',
  mayıs: 'May',
  haziran: 'June',
  temmuz: 'July',
  ağustos: 'August',
  eylül: 'September',
  ekim: 'October',
  kasım: 'November',
  aralık: 'December',
  kahya: 'steward',
  agha: 'landowner',
  konak: 'residence',
  kile: 'grain measures',
  yayla: 'yayla (summer highland pasture)',
  pekmez: 'pekmez (grape syrup)',
  reeve: 'reeve (local overseer)',
  'one sheaf in eight': 'one sheaf in eight (one eighth of the harvest as pay)',
  'a sheaf in eight': 'a sheaf in eight (one eighth of the harvest as pay)',
};
const TERM =
  /(?<!\p{L})(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık|kahya|agha|konak|kile|yayla|pekmez|reeve|one sheaf in eight|a sheaf in eight)(?!\p{L})/giu;

/** Translate calendar and office terms; gloss unfamiliar words without changing saved copy. */
export function englishText(text: string): string {
  for (const [before, after] of DISPLAY_REPLACEMENTS) text = text.replaceAll(before, after);
  text = text
    .replace(/\. After\.$/, '. I can come after that.')
    .replace(/^Put (.+) off today: (.+)\.$/, '$2 postponed $1 today.')
    .replace(/^Came (.+): (.+)\.$/, '$2 came $1.')
    .replace(/^Carried stone for the mill today: (.+)\.$/, '$1 carried stone for the mill today.')
    .replace(/^Brought their share today: (.+)\.$/, '$1 brought their share today.')
    .replace(/Bread baked at the (.+) oven today;/, 'People baked bread at the $1 oven today;')
    .replace(
      /The agha’s letter came up the valley with you: his barley in before the rains, his due of (.+) by (.+)\. The last/,
      'The agha’s letter came up the valley with you. He wants his barley cut before the rains. His due of $1 must be ready by $2. The last',
    )
    .replace(/Osman the reeve, at your elbow:/, 'Osman the reeve stands beside you and says:')
    .replace(/Osman the reeve, low:/, 'Osman the reeve says quietly:')
    .replace(/Osman, at the granary door:/, 'Osman speaks at the granary door:')
    .replace(/His own field, every house’s share/, 'This includes his own field and every house’s share')
    .replace(/The old men say rain in two days\./, 'The old men say it will rain in two days.')
    .replace(/\. the reeve /g, '. The reeve ')
    .replace(/^Snow on the upper lanes\./, 'Snow covers the upper lanes.')
    .replace(/^Washing day at the spring\./, 'People are washing clothes at the spring.')
    .replace(/^Too hot to work at noon\./, 'It was too hot to work at noon.')
    .replace(/^(.+ of .+), ([^:]+):$/, '$1 speaks $2:');
  return text.replace(TERM, (word: string, _term: string, offset: number) => {
    if (word === 'Yayla') return word; // A household name, not the pasture term.
    // A sheet may project text already projected by a smaller component.
    if (text.slice(offset + word.length).startsWith(' (')) return word;
    const translated = ENGLISH[word.toLocaleLowerCase('tr')];
    if (!translated) return word;
    return word[0] === word[0]?.toLocaleUpperCase('tr')
      ? translated[0]?.toUpperCase() + translated.slice(1)
      : translated;
  });
}

export { dateEnglish };

/** Full dates make renewal across New Year explicit. */
export function fullDateEnglish(day: number): string {
  const year = ['one', 'two', 'three', 'four'][yearOf(day) - 1] ?? String(yearOf(day));
  return `${dateEnglish(day)}, year ${year}`;
}

export function cropRenewalDay(s: ValleyState): number {
  const day = dayOfMinute(s.minute);
  const gap = (175 - doyOf(day) + 365) % 365;
  return day + (gap || 365);
}

export function cropReturnWords(s: ValleyState): string {
  const day = cropRenewalDay(s);
  return day > END_DAY
    ? 'No further shares or easing renew during your term.'
    : `Shares and easing renew with the new crop on ${fullDateEnglish(day)}.`;
}

export function loanReturnWords(s: ValleyState): string | null {
  if (!s.agha.loan || s.minute - s.agha.loan.asked >= 300 * DAY) return null;
  const day = dayOfMinute(s.agha.loan.asked) + 300;
  return day > END_DAY
    ? 'The last loan letter bars another for the rest of your term.'
    : `The last loan letter bars another; you can write again on ${fullDateEnglish(day)}.`;
}

function riderHasCome(s: ValleyState): boolean {
  return dayOfMinute(s.minute) >= s.agha.dueDay;
}

export function unpaidShares(s: ValleyState): boolean {
  return s.households.some((h) => underSeal(s, h) && h.members.length && h.paid < shareOwed(h) - 0.5);
}

// Rider receipts are existing saved notes; reading them avoids changing old save state.
function riderReceipt(s: ValleyState) {
  return s.notes.find((n) => n.kind === 'due' && dayOfMinute(n.at) === s.agha.dueDay);
}

export const PURPOSE =
  'You are the valley’s steward. Bring in the landowner’s due, keep the valley fed, and earn its trust. Your term lasts three years; the elders will say what they remember.';

/** What follows this season, including dates that explain an idle granary. */
export function nextWords(s: ValleyState): string {
  if (s.flags.ended) return 'The term is over. The valley keeps its own account of your years here.';
  const day = dayOfMinute(s.minute);
  const doy = doyOf(day);
  const receipt = riderReceipt(s);
  const rider = receipt
    ? receipt.text.includes('whole due')
      ? 'The due is in. Keep grain for winter and visit the households.'
      : 'The rider has taken what was ready; keep grain for winter and hear how the households are keeping.'
    : riderHasCome(s)
      ? 'The rider has come and gone. Keep grain for winter and visit the households.'
      : `The rider comes on ${fullDateEnglish(nextRiderDay(s))}.`;
  const unpaid = unpaidShares(s);
  if (riderHasCome(s) && (seasonOf(doy) === 'threshing' || seasonOf(doy) === 'autumn'))
    return `${rider} The households turn to sowing before winter.`;
  switch (seasonOf(doy)) {
    case 'harvest':
      return `About ${Math.round(s.agha.reaped / 5) * 5} kile are cut. About ${Math.round(s.agha.standing / 10) * 10} kile are still standing. ${day < 18 ? 'Rain is expected on 20 July.' : 'Cut the barley before more rain.'} Threshing turns the cut barley into grain from 5 August. The due must be ready by ${dateEnglish(nextRiderDay(s))}. ${s.flags.verbs.includes('take') ? 'Collect shares during threshing.' : 'You can collect shares from 9 August.'}`;
    case 'threshing':
      return doy < 220 && !s.flags.verbs.includes('take')
        ? `Cut sheaves are becoming grain. Shares can be called in from 9 August. ${rider}`
        : `${unpaid ? 'The threshing floors turn cut sheaves into grain; bring in the unpaid shares before the rider.' : 'All shares are paid; keep grain for winter and visit the households.'} ${rider}`;
    case 'autumn':
      return `${rider} The households will turn to sowing, then prepare for winter.`;
    case 'sowing':
      return 'The households sow their own fields. Winter will bring hungry doors; keep grain for them.';
    case 'winter':
      return s.agha.millOpen && s.agha.mill < V.millHours
        ? 'The mill needs hands while the fields are idle; it will reduce the landowner’s future due.'
        : !s.agha.millOpen
          ? 'Watch for hungry doors. A millwright will bring work for the winter.'
          : 'The mill is turning. Watch for hungry doors until spring and the next harvest.';
    case 'spring':
      return 'The households tend their fields. Summer brings the new crop and renews the shares on 25 June.';
    case 'summer': {
      const crop =
        doy >= 175
          ? 'The new crop stands; shares have renewed. Harvest begins on 30 June.'
          : `The new crop renews shares on ${fullDateEnglish(cropRenewalDay(s))}; harvest follows.`;
      return !s.flags.upper && yearOf(day) <= 2
        ? `The upper hamlet comes under your seal in the second summer. ${crop}`
        : `${crop} The upper hamlet’s households now share your due.`;
    }
  }
}

export function currentJob(s: ValleyState): Job | undefined {
  const season = seasonOf(doyOf(dayOfMinute(s.minute)));
  if ((season === 'harvest' || season === 'threshing') && s.agha.standing > 5) return 'reap-agha';
  if (
    s.flags.verbs.includes('take') &&
    !riderHasCome(s) &&
    unpaidShares(s) &&
    (season === 'threshing' || season === 'autumn')
  )
    return 'bring-share';
  if (s.agha.millOpen && s.agha.mill < V.millHours) return 'build-mill';
  return undefined;
}

/** One immediate direction, in order of urgency. */
export function nowWords(s: ValleyState): string {
  if (s.flags.ended === 'term') return 'Read what the elders remember of your term.';
  if (s.flags.ended) return 'Read the letter that ends your service.';
  const knock = s.knocks.find((k) => !k.answered && k.at <= s.minute && k.until > s.minute);
  if (knock)
    return knock.what === 'grain'
      ? 'Someone waits at your door for grain; answer them.'
      : 'Someone waits at your door with family news; answer them.';
  if (s.kahyaState.visit && s.kahyaState.visit.back > s.minute)
    return 'Your visit is underway. You will return to the residence.';
  const job = currentJob(s);
  const ask =
    job && s.asks.find((a) => a.job === job && !a.closed && a.from <= s.minute && a.until > s.minute);
  if (ask) return 'The call is underway; replies are available at the houses.';
  if (job === 'reap-agha') return 'Call households to cut the landowner’s barley before the rain.';
  if (job === 'bring-share') return 'Call the unpaid households to bring their shares.';
  const paid = riderReceipt(s)?.text.includes('whole due');
  if (job === 'build-mill')
    return `${paid ? 'The due is in. ' : ''}Call households to carry stone for the mill.`;
  if (paid)
    return 'The due is in. Keep grain for winter; visit the households and hear how they are keeping.';
  if (!riderHasCome(s) && s.agha.granary >= s.agha.due && s.agha.due > 0)
    return 'The due is ready; visit the households and hear how they are keeping.';
  if (riderHasCome(s))
    return 'The rider has come and gone. Keep grain for hungry doors; visit a household and hear how they are keeping.';
  if (s.agha.reaped > 0 && seasonOf(doyOf(dayOfMinute(s.minute))) === 'threshing')
    return 'Let the threshing floors bring the cut sheaves into the granary.';
  if (s.agha.standing <= 5 && s.agha.reaped > 0 && seasonOf(doyOf(dayOfMinute(s.minute))) === 'harvest')
    return 'The barley is cut; visit a household while the sheaves wait for threshing.';
  return 'Visit a household and hear how they are keeping.';
}

/** A missing date means the return depends on an event, not a timer. */
export function callUnavailable(s: ValleyState, job: Job, house?: Household): string | null {
  if (s.flags.ended) return 'Your service has ended; calls will not return this term.';
  if (house && !house.members.length)
    return 'This house is empty; calls return only if someone lives here again.';
  if (house && !underSeal(s, house))
    return 'Calls open when this hamlet comes under your seal on 10 June, year two.';
  const day = dayOfMinute(s.minute);
  const doy = doyOf(day);
  const renewal = cropReturnWords(s);
  if (job === 'bring-share') {
    if (house ? house.paid >= shareOwed(house) - 0.5 : !unpaidShares(s)) return `Shares are paid. ${renewal}`;
    if (riderHasCome(s)) return `The rider has left. ${renewal}`;
    if (!s.flags.verbs.includes('take')) return 'Shares open during threshing on 9 August, year one.';
    if (!['threshing', 'autumn'].includes(seasonOf(doy))) {
      let starts = day + ((216 - doy + 365) % 365);
      if (starts === day) starts += 365;
      return starts > END_DAY
        ? 'No further share calls return during your term.'
        : `Share calls return at threshing on ${fullDateEnglish(starts)}.`;
    }
  }
  if (job === 'reap-agha' && (!['harvest', 'threshing'].includes(seasonOf(doy)) || s.agha.standing <= 5)) {
    let starts = day + ((180 - doy + 365) % 365);
    if (starts === day) starts += 365;
    if (starts > END_DAY) return 'No further harvest calls return during your term.';
    return `${s.agha.standing <= 5 ? 'The barley is cut.' : 'It is outside harvest.'} Harvest calls return on ${fullDateEnglish(starts)}.`;
  }
  if (job === 'build-mill') {
    if (s.agha.mill >= V.millHours)
      return 'The mill is complete; no further stone calls are needed this term.';
    if (!s.agha.millOpen) return 'Mill work opens with the millwright’s letter on 27 November, year one.';
  }
  const ask = s.asks.find(
    (a) =>
      a.job === job &&
      !a.closed &&
      a.from <= s.minute &&
      a.until > s.minute &&
      (!house || a.houses.includes(house.id)),
  );
  return ask
    ? `The current call is open; another opens when it expires on ${fullDateEnglish(dayOfMinute(ask.until))}.`
    : null;
}

/** Explain actual gates and their renewal, never an invented daily action allowance. */
export function limitsWords(s: ValleyState, house?: Household): string {
  if (s.flags.ended) return 'Your service has ended; the seal is no longer yours to use.';
  const out: string[] = [];
  if (house && !house.members.length) return 'This house is empty; nobody here can answer a call.';
  if (house && !underSeal(s, house))
    out.push('This house is outside your seal until the upper hamlet joins in the second summer.');
  if (s.kahyaState.visit && s.kahyaState.visit.back > s.minute)
    out.push('You can start another visit when you return to the residence.');
  else if (!s.flags.verbs.includes('visit'))
    out.push(
      'Your seal reaches the houses through the crier first. If a household puts your call off, you can visit in person.',
    );
  else out.push('A visit takes walking and sitting time; you can go again when you return.');
  const job = currentJob(s);
  const ask =
    job &&
    s.asks.find(
      (a) =>
        a.job === job &&
        !a.closed &&
        a.from <= s.minute &&
        a.until > s.minute &&
        (!house || a.houses.includes(house.id)),
    );
  if (ask)
    out.push(
      `The current call is still open; another call for this work opens when it expires on ${fullDateEnglish(dayOfMinute(ask.until))}.`,
    );
  if (house?.eased) out.push(`Their share is already eased. ${cropReturnWords(s)}`);
  if (house && house.paid >= shareOwed(house) - 0.5) out.push(`Their share is paid. ${cropReturnWords(s)}`);
  if (s.agha.granary < 2)
    out.push(
      'The granary is empty or too low to send grain; gifts open again when threshing, shares, or a loan bring grain in.',
    );
  const loan = loanReturnWords(s);
  if (loan) out.push(loan);
  return out.join(' ');
}
