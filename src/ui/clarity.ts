/** Pure presentation reads; no simulation or pacing changes. */
export function clockWords(minute: number): string {
  const day = Math.floor(minute) % 1440;
  return `${String(Math.floor(day / 60)).padStart(2, '0')}:${String(day % 60).padStart(2, '0')}`;
}
export function grainReceipt(
  house: string,
  dispatched: number,
  before: number,
  after: number,
  note = '',
): string {
  const onward = note.match(/They carried it on to .+ before dark\./)?.[0];
  const returned = note.includes('The sack came back up the lane before dark.');
  return `Dispatched ${dispatched} measures to ${house}.${returned ? ' The sack returned.' : onward ? ` ${onward}` : ''} Net granary cost: ${before - after} measures. Your granary now holds ${after} measures.`;
}
export function paceWords(s: {
  waiting: boolean;
  reading: boolean;
  hurrying: boolean;
  asked?: boolean;
  replies?: boolean;
  readingView?: string;
  waitingReason?: string;
  pace?: string;
  night?: boolean;
  travelling?: boolean;
  working?: boolean;
}): string {
  return s.asked
    ? 'Someone is waiting for your answer. Time almost stops until you answer or choose Not now.'
    : s.waiting
      ? `${s.waitingReason ?? 'Someone is at your door or a decision is open.'} Time moves slowly while this is open.`
      : s.reading
        ? s.readingView
          ? `Time moves slowly while the ${s.readingView === 'house' ? 'house page' : s.readingView === 'ledger' ? 'ledger' : s.readingView === 'reader' ? 'earlier replies view' : 'orders view'} is open. Back returns to the notebook.`
          : 'New replies or news have slowed time for reading. This reading slowdown lasts a few seconds.'
        : s.hurrying
          ? 'Skipping toward the next event.'
          : s.replies
            ? 'Time moves slowly while delayed replies to your call are open. Skip, or let them finish first.'
            : `${s.pace && s.pace !== 'automatic' ? `Your ${s.pace} pace is selected.` : s.working ? 'Time follows the work season.' : 'Time follows the quiet season.'}${s.night && !s.travelling ? ' It runs faster at night while you are home.' : ''} Menu and Information pause it.`;
}
/** Why Skip cannot run now, said at the button; null when it can. */
export function skipBlock(s: { waiting: boolean; hurrying: boolean; asked?: boolean }): string | null {
  return s.hurrying
    ? 'Skipping. It stops at the next event.'
    : s.asked
      ? 'Someone is waiting for your answer. Answer or choose Not now first.'
      : s.waiting
        ? 'Skip waits until the person at your door or the open decision is answered.'
        : null;
}
export function travelWords(v: { arrive: number; leave: number; back: number }, minute: number): string {
  const home = Math.max(0, v.back - minute);
  return minute < v.arrive
    ? `${v.arrive - minute} game minutes until arrival; ${home} until home.`
    : minute < v.leave
      ? `${v.leave - minute} game minutes left here; ${home} until home.`
      : `${home} game minutes until home.`;
}

/** Project the committed outflow; a full household may later return some grain. */
export function grainPreview(house: string, stock: number): string {
  const amount = Math.min(6, stock);
  return `Send ${amount} measures of grain to ${house}? Your granary will hold ${stock - amount} measures before any returned grain. No grain has been sent.`;
}
