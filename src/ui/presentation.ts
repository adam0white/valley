/** English explanations and term glosses for preserved HF labels and older saved text. */
import { DAY, dateEnglish, dayOfMinute, doyOf, seasonOf, yearOf } from '../sim/calendar.ts';
import { END_DAY } from '../sim/game.ts';
import type { Household } from '../sim/people.ts';
import { type Job, nextRiderDay, shareOwed, underSeal, V, type ValleyState } from '../sim/valley.ts';

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
  yayla: 'summer highland pasture',
  pekmez: 'grape syrup',
  reeve: 'local overseer',
  'one sheaf in eight': 'one sheaf in eight (one eighth of the harvest as pay)',
  'a sheaf in eight': 'a sheaf in eight (one eighth of the harvest as pay)',
};
const TERM =
  /(?<!\p{L})(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık|kahya|agha|konak|kile|yayla|pekmez|reeve|one sheaf in eight|a sheaf in eight)(?!\p{L})/giu;

/** Translate calendar and office terms; gloss unfamiliar words without changing saved copy. */
export function englishText(text: string): string {
  text = text
    .replace(/ (?:His|Their) duties will remain in (?:his|their) home records\./g, '')
    .replace(' The game does not show his journey home.', '')
    .replace(' Nobody has promised paid survey work.', '')
    .replace(' These guests come from different families.', '')
    .replace(
      / agrees to leave after the current work\. (?:He|She) must still meet any duties and follow any health limits\. The visit has not ended yet\./g,
      ' will leave when the current work ends.',
    )
    .replace('a wooden token', 'a small piece of wood')
    .replace(/Someone from (the .+? house) had a (boy|girl)\./g, 'A woman of $1 had a $2.')
    .replace(/Someone from (the .+? house)(?= married )/g, 'A woman of $1')
    .replace(/ married someone from (the .+? house)\./g, ' married a man of $1.');
  text = text.replaceAll('Hajja Maryam', 'Maryam');
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
    ? 'Shares and reductions will not renew again during your term.'
    : `Shares and reductions renew with the new crop on ${fullDateEnglish(day)}.`;
}

export function loanReturnWords(s: ValleyState): string | null {
  if (!s.agha.loan || s.minute - s.agha.loan.asked >= 300 * DAY) return null;
  const day = dayOfMinute(s.agha.loan.asked) + 300;
  return day > END_DAY
    ? 'You cannot request another loan during the rest of your term.'
    : `You cannot request another loan yet. You can write again on ${fullDateEnglish(day)}.`;
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
      return `${s.agha.reaped === 0 ? 'No barley is cut yet.' : s.agha.reaped < 2.5 ? 'Less than 5 grain measures are cut.' : `About ${Math.round(s.agha.reaped / 5) * 5} grain measures are cut.`} About ${Math.round(s.agha.standing / 10) * 10} grain measures are still in the field. ${day < 18 ? 'Rain is expected on 20 July.' : 'Cut the barley before more rain.'} From 5 August, people will beat the cut barley to separate the grain from its stalks. The landowner’s payment must be ready by ${dateEnglish(nextRiderDay(s))}. ${s.flags.verbs.includes('take') ? 'Collect each household’s share while people separate the grain.' : 'You can collect each household’s share from 9 August.'}`;
    case 'threshing':
      return doy < 220 && !s.flags.verbs.includes('take')
        ? `People are separating grain from bundles of cut barley. Shares can be called in from 9 August. ${rider}`
        : `${unpaid ? 'People are separating grain from cut barley. Bring in the unpaid shares before the rider arrives.' : 'All shares are paid; keep grain for winter and visit the households.'} ${rider}`;
    case 'autumn':
      return `${rider} The households will turn to sowing, then prepare for winter.`;
    case 'sowing':
      return 'The households sow their own fields. People will need grain in winter. Keep grain for them.';
    case 'winter':
      return s.agha.millOpen && s.agha.mill < V.millHours
        ? 'The mill needs workers while the fields are idle. It will reduce the grain the landowner requires in future.'
        : !s.agha.millOpen
          ? 'Watch for people who need grain. A mill builder will bring work for the winter.'
          : 'The mill is turning. Watch for people who need grain until spring and the next harvest.';
    case 'spring':
      return 'The households tend their fields. Summer brings the new crop and renews the shares on 25 June.';
    case 'summer': {
      const crop =
        doy >= 175
          ? 'The new crop is growing in the fields. Shares have renewed. Harvest begins on 30 June.'
          : `The new crop renews shares on ${fullDateEnglish(cropRenewalDay(s))}; harvest follows.`;
      return !s.flags.upper && yearOf(day) <= 2
        ? `You gain authority over the upper hamlet in the second summer. ${crop}`
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
  if (paid) return 'The due is in. Keep grain for winter; visit the households and ask how they are doing.';
  if (!riderHasCome(s) && s.agha.granary >= s.agha.due && s.agha.due > 0)
    return 'The due is ready; visit the households and ask how they are doing.';
  if (riderHasCome(s))
    return 'The rider has come and gone. Keep grain for people who need it. Visit a household and ask how they are doing.';
  if (s.agha.reaped > 0 && seasonOf(doyOf(dayOfMinute(s.minute))) === 'threshing')
    return 'Wait for people to separate the grain from cut barley and bring it into the granary.';
  if (s.agha.standing <= 5 && s.agha.reaped > 0 && seasonOf(doyOf(dayOfMinute(s.minute))) === 'harvest')
    return 'The barley is cut. Visit a household while the cut barley waits for people to separate the grain.';
  return 'Visit a household and ask how they are doing.';
}

/** A missing date means the return depends on an event, not a timer. */
export function callUnavailable(s: ValleyState, job: Job, house?: Household): string | null {
  if (s.flags.ended) return 'Your service has ended. You cannot send more requests this term.';
  if (house && !house.members.length)
    return 'This house is empty; calls return only if someone lives here again.';
  if (house && !underSeal(s, house))
    return 'You can send requests when you gain authority over this hamlet on 10 June, year two.';
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
    if (!s.agha.millOpen) return 'Mill work opens with the mill builder’s letter on 27 November, year one.';
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
  if (s.flags.ended) return 'Your service has ended. You no longer have authority here.';
  const out: string[] = [];
  if (house && !house.members.length) return 'This house is empty; nobody here can answer a call.';
  if (house && !underSeal(s, house))
    out.push('You have no authority over this house until the upper hamlet joins in the second summer.');
  if (s.kahyaState.visit && s.kahyaState.visit.back > s.minute)
    out.push('You can start another visit when you return to the residence.');
  else out.push('A visit takes time to walk and sit with the household. You can go again when you return.');
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
  if (house?.eased) out.push(`${shareOwnerWords(s, house)} has already been reduced.`);
  if (house && house.paid >= shareOwed(house) - 0.5) out.push(paidShareWords(s, house));
  if (house && (house.eased || house.paid >= shareOwed(house) - 0.5)) out.push(cropReturnWords(s));
  if (s.agha.granary < 2)
    out.push(
      'The granary is empty or too low to send grain; gifts open again when threshing, shares, or a loan bring grain in.',
    );
  const loan = loanReturnWords(s);
  if (loan) out.push(loan);
  return out.join(' ');
}

/** Describe the grain account without implying a voluntary payment. */
export function shareOwnerWords(s: ValleyState, house: Household): string {
  const p = house.members.length === 1 ? s.people.find((p) => p.id === house.members[0]) : undefined;
  return p && !['a household member', 'a child'].includes(p.name)
    ? `${p.name}’s share`
    : 'This household’s share';
}
export function paidShareWords(s: ValleyState, house: Household): string {
  return `${shareOwnerWords(s, house)} is paid.`;
}

/** Keep one complete greeting sentence; raw visit dialogue remains replay state. */
export function visitLine(words: string): string {
  return words.match(/^.*?[.!?](?:[”’](?=\s|$))?(?=\s|$)/)?.[0] ?? words;
}

export function noteWords(n: { kind: string; text: string; words?: string }): string | undefined {
  return n.kind === 'voice' && / speaks (?:by the fire|at the wedding):$/.test(n.text) && n.words
    ? visitLine(n.words)
    : n.words;
}
