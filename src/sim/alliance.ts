/** SCOPE: one Çam public road agreement. The collective terms are authored world rules,
 * not an autonomous HF negotiator or a generic trust/contract faculty. The office pays
 * six carried grain; Çam reserves one finite stone; twelve useful hours of voluntary
 * local repair earn collection before fourteen days. Travel/work compete with real life.
 * Failure releases the reserved stock, never the consumed grain or labor. No new cast.
 */

import { DAY, daylight, dayOfMinute, doyOf, HOUR, minuteOfDay } from './calendar.ts';
import { allianceEdition } from './edition.ts';
import type { Activity, Affordance, Outcome, Person, Suggestion } from './hf.ts';
import { KAHYA } from './people.ts';
import { hasOfficeCard, note, personOf, promote, type ValleyState } from './valley.ts';

export interface AllianceState {
  from: number;
  until: number;
  status: 'active' | 'completed' | 'refused' | 'breached' | 'expired';
  hours: number;
  reserved: number;
  grain: number;
  work: { from: number; to: number; hours: number }[];
}
export type AllianceChoice = 'accept' | 'decline' | 'collect' | 'withdraw';
const emit = (s: ValleyState, text: string) => note(s, { at: s.minute, kind: 'story', text, weight: 3 });
export function allianceChoice(s: ValleyState, choice: AllianceChoice): boolean {
  if (hasOfficeCard(s) || !allianceEdition(s.edition?.id) || s.flags.ended || !s.pass) return false;
  const p = s.pass;
  const a = p.alliance;
  const j = p.journey;
  const there = j?.seen && !j.failed && !j.returned && s.minute >= j.arrive && s.minute < j.leave;
  if (choice === 'withdraw') {
    if (a?.status !== 'active') return false;
    settleFailure(s, 'breached');
    return true;
  }
  if (choice === 'collect') {
    if (
      !there ||
      !a ||
      a.status !== 'active' ||
      s.minute >= a.until ||
      a.hours < 12 ||
      a.reserved !== 1 ||
      !j ||
      j.cargo
    )
      return false;
    j.cargo = a.reserved;
    a.reserved = 0;
    a.status = 'completed';
    emit(
      s,
      'Çam released the reserved stone after the road work was completed. It is on your load now. You must still carry it home. This road agreement is complete.',
    );
    return true;
  }
  if (!there || a || !j) return false;
  if (choice === 'decline' || p.stock < 1) {
    p.alliance = {
      from: s.minute,
      until: s.minute,
      status: 'refused',
      hours: 0,
      reserved: 0,
      grain: 0,
      work: [],
    };
    emit(
      s,
      choice === 'decline'
        ? 'You declined Çam’s road terms. Neither valley owes work or goods under an agreement.'
        : 'Çam’s public road terms cannot be accepted: no stone remains to reserve. No grain changed hands.',
    );
    return true;
  }
  if (choice !== 'accept' || j.grain < 6 || !personOf(s, 'yusuf-usta')?.body.alive) return false;
  j.grain -= 6;
  p.grainReceived += 6;
  p.stock--;
  p.alliance = {
    from: s.minute,
    until: s.minute + 14 * DAY,
    status: 'active',
    hours: 0,
    reserved: 1,
    grain: 6,
    work: [],
  };
  promote(s, 'yusuf-usta');
  emit(
    s,
    'You accepted Çam’s public road agreement for the steward’s office. Your carried sack pays their road crew. They set one existing stone aside. You undertake to arrange about two working days of repairs on this side within a fortnight, then collect the stone. Yusuf Usta can choose whether to help. If the work or collection fails, the reservation ends. The grain and time spent do not come back.',
  );
  return true;
}
function settleFailure(s: ValleyState, status: 'breached' | 'expired') {
  const p = s.pass;
  const a = p?.alliance;
  if (!p || !a || a.status !== 'active') return;
  p.stock += a.reserved;
  a.reserved = 0;
  a.status = status;
  emit(
    s,
    status === 'breached'
      ? 'The road agreement was not fulfilled. Çam released the reserved stone. The sack already spent on their crew and any completed repair time remain spent.'
      : 'The road was repaired, but the collection period ended. Çam released the reserved stone. The grain and repair time remain spent.',
  );
}
export function allianceTick(s: ValleyState) {
  const a = s.pass?.alliance;
  if (a?.status === 'active' && s.minute >= a.until) settleFailure(s, a.hours < 12 ? 'breached' : 'expired');
}
export function allianceOffers(s: ValleyState, p: Person, at: number): Affordance[] {
  const a = s.pass?.alliance;
  const { rise, set } = daylight(doyOf(dayOfMinute(at)));
  if (
    s.flags.ended ||
    a?.status !== 'active' ||
    a.hours >= 12 ||
    p.id !== 'yusuf-usta' ||
    !p.body.alive ||
    at < a.from ||
    at + 4 * HOUR > a.until ||
    minuteOfDay(at) < rise ||
    minuteOfDay(at) + 4 * HOUR > set
  )
    return [];
  return [
    {
      id: `road:${a.from}`,
      action: 'repair-pass',
      label: 'walk to the pass, repair the road and return',
      duration: 4 * HOUR,
      effort: 0.35,
      placeId: 'pass:local',
      advertises: { competence: 0.12, belonging: 0.1 },
      tags: ['work', 'outdoors'],
    },
  ];
}
export function allianceSuggestion(s: ValleyState, p: Person): Suggestion | undefined {
  const a = s.pass?.alliance;
  return a?.status === 'active' && a.hours < 12 && p.id === 'yusuf-usta'
    ? { voiceId: KAHYA, action: 'repair-pass', strength: 0.35, appeal: 'duty', since: a.from }
    : undefined;
}
export function resolveAlliance(
  s: ValleyState,
  p: Person,
  activity: Activity,
  reason: 'ended' | 'interrupted',
): Outcome | undefined {
  if (!activity.affordanceId.startsWith('road:')) return;
  const out: Outcome = {
    action: activity.action,
    affordanceId: activity.affordanceId,
    status: reason === 'ended' ? 'completed' : 'interrupted',
    at: p.now,
  };
  const a = s.pass?.alliance;
  if (
    s.flags.ended ||
    a?.status !== 'active' ||
    p.id !== 'yusuf-usta' ||
    activity.affordanceId !== `road:${a.from}` ||
    activity.startedAt < a.from ||
    p.now >= a.until ||
    reason !== 'ended' ||
    activity.endsAt > p.now ||
    a.work.some((w) => w.from === activity.startedAt)
  )
    return out;
  const hours = Math.min(12 - a.hours, Math.max(0, (activity.endsAt - activity.startedAt - 2 * HOUR) / HOUR));
  a.work.push({ from: activity.startedAt, to: activity.endsAt, hours });
  a.hours += hours;
  if (a.hours >= 12)
    emit(
      s,
      'Yusuf Usta completed the promised repairs on this side of the pass. Çam’s reserved stone still needs collection over the pass before the agreement ends.',
    );
  return { ...out, needs: { competence: 0.06 } };
}
