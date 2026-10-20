/** Read-only English copy for the steward's notebook. Saved words remain untouched. */
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
      return `About ${Math.round(s.agha.reaped / 5) * 5} cut; ${Math.round(s.agha.standing / 10) * 10} standing. ${day < 2 ? 'Rain: 20 July. ' : day < 18 ? 'First rain: 20 July. ' : 'Cut before more rain. '}Sheaves become grain: 5 August. Due: ${dateEnglish(nextRiderDay(s))}. ${s.flags.verbs.includes('take') ? 'Shares during threshing.' : 'Shares: 9 August.'}`;
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
    return 'Visit underway; you will return to the residence.';
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
