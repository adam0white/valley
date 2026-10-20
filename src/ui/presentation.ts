/** Read-only English copy for the steward's notebook. Saved words remain untouched. */
import { DAY, dayOfMinute, doyOf, monthDay, monthEnglish, seasonOf, yearOf } from '../sim/calendar.ts';
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
};
const TERM =
  /(?<!\p{L})(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık|kahya|agha|konak|kile)(?!\p{L})/giu;

/** Translate only calendar and office terms; retain names, greetings, and voice. */
export function englishText(text: string): string {
  return text.replace(TERM, (word: string) => {
    const translated = ENGLISH[word.toLocaleLowerCase('tr')];
    if (!translated) return word;
    return word[0] === word[0]?.toLocaleUpperCase('tr')
      ? translated[0]?.toUpperCase() + translated.slice(1)
      : translated;
  });
}

export function dateEnglish(day: number): string {
  return `${monthDay(doyOf(day)).date} ${monthEnglish(day)}`;
}

export const PURPOSE =
  'You are the valley’s steward. Bring in the landowner’s due, keep the valley fed, and earn its trust. Your term lasts three years; the elders will say what they remember.';

/** What follows this season, including dates that explain an idle granary. */
export function nextWords(s: ValleyState): string {
  if (s.flags.ended) return 'The term is over. The valley keeps its own account of your years here.';
  const day = dayOfMinute(s.minute);
  const doy = doyOf(day);
  const rider = `The rider comes on ${dateEnglish(nextRiderDay(s))}.`;
  const shares = s.flags.verbs.includes('take')
    ? 'Shares can be called in during threshing.'
    : 'Shares can be called in from 9 August.';
  switch (seasonOf(doy)) {
    case 'harvest':
      return `Next: threshing starts on 5 August; cut sheaves become grain. ${shares}`;
    case 'threshing':
      return doy < 220 && !s.flags.verbs.includes('take')
        ? `Cut sheaves are becoming grain. Shares can be called in from 9 August. ${rider}`
        : `The threshing floors turn cut sheaves into grain; bring in the unpaid shares before the rider. ${rider}`;
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
    case 'summer':
      return !s.flags.upper && yearOf(day) <= 2
        ? 'The upper hamlet comes under your seal in the second summer. The new crop renews shares on 25 June; harvest follows.'
        : 'The new crop renews shares on 25 June. Harvest follows; the upper hamlet’s households now share your due.';
  }
}

function currentJob(s: ValleyState): Job | undefined {
  const season = seasonOf(doyOf(dayOfMinute(s.minute)));
  if ((season === 'harvest' || season === 'threshing') && s.agha.standing > 5) return 'reap-agha';
  if (s.flags.verbs.includes('take') && (season === 'threshing' || season === 'autumn')) return 'bring-share';
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
    return 'Read the notebook while you finish this visit and return to the residence.';
  const job = currentJob(s);
  const ask =
    job && s.asks.find((a) => a.job === job && !a.closed && a.from <= s.minute && a.until > s.minute);
  if (ask) return 'Read the replies to your standing call; people decide around their own work.';
  if (job === 'reap-agha') return 'Call households to cut the landowner’s barley before the rain.';
  if (job === 'bring-share') {
    const unpaid = s.households.some(
      (h) => underSeal(s, h) && h.members.length && h.paid < shareOwed(h) - 0.5,
    );
    if (unpaid) return 'Call the unpaid households to bring their shares.';
  }
  if (s.agha.granary >= s.agha.due && s.agha.due > 0)
    return 'The due is ready; visit the households and hear how they are keeping.';
  if (job === 'build-mill') return 'Call households to carry stone for the mill.';
  if (s.agha.reaped > 0 && seasonOf(doyOf(dayOfMinute(s.minute))) === 'threshing')
    return 'Let the threshing floors bring the cut sheaves into the granary.';
  if (s.agha.standing <= 5 && s.agha.reaped > 0 && seasonOf(doyOf(dayOfMinute(s.minute))) === 'harvest')
    return 'The barley is cut; visit a household while the sheaves wait for threshing.';
  return 'Visit a household and hear how they are keeping.';
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
      `The current call is still open; another call for this work opens when it expires on ${dateEnglish(dayOfMinute(ask.until))}.`,
    );
  if (house?.eased)
    out.push('Their share is already eased; easing opens again with the new crop on 25 June.');
  if (house && house.paid >= shareOwed(house) - 0.5)
    out.push('Their share is paid; a new share is entered with the new crop on 25 June.');
  if (s.agha.granary < 2)
    out.push(
      'The granary is empty or too low to send grain; gifts open again when threshing, shares, or a loan bring grain in.',
    );
  if (s.agha.loan && s.minute - s.agha.loan.asked <= 300 * DAY)
    out.push(
      `The last loan letter still bars another; you can write again after ${dateEnglish(dayOfMinute(s.agha.loan.asked) + 300)}.`,
    );
  return out.join(' ');
}
