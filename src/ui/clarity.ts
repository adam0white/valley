/** Pure presentation reads; no simulation or pacing changes. */
export function clockWords(minute: number): string {
  const day = Math.floor(minute) % 1440;
  return `${String(Math.floor(day / 60)).padStart(2, '0')}:${String(day % 60).padStart(2, '0')}`;
}
export function grainReceipt(house: string, before: number, after: number): string {
  const sent = before - after;
  return sent > 0
    ? `Sent grain to ${house}. The gift is recorded in the ledger and leaves less for the landowner.`
    : 'No grain was sent.';
}
export function paceWords(s: { waiting: boolean; reading: boolean; hurrying: boolean }): string {
  return s.waiting
    ? 'Time moves slowly while replies or a decision remain open. Skip keeps this slowdown.'
    : s.reading
      ? 'Time moves slowly while you read. Return to the notebook to leave this reading view.'
      : s.hurrying
        ? 'Skipping toward the next event.'
        : 'Time is moving. Menu and Information pause it.';
}
export function travelWords(v: { arrive: number; leave: number; back: number }, minute: number): string {
  const home = Math.max(0, v.back - minute);
  return minute < v.arrive
    ? `${v.arrive - minute} game minutes until arrival; ${home} until home.`
    : minute < v.leave
      ? `${v.leave - minute} game minutes left here; ${home} until home.`
      : `${home} game minutes until home.`;
}
