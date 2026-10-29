/** SCOPE: a bounded supervised local introduction, not a wedding or consent substitute.
 * Ali22 and Esma19 are existing incidental adults; Omer48 is her recorded father.
 * HF owns choosing attendance against ordinary needs/work and courtship changes.
 * The public sourced Muslim custom guards eligibility. Its age18/one spouse are
 * authored conventions, not a historical claim. Attendance is never guardian consent.
 * Research: released partnering SCOPE; research/marriage-sources.md §§1–6,10.
 * No new actor, altered norm, compatibility display, proposal or marriage is created.
 */

import { DAY, daylight, dayOfMinute, doyOf, HOUR, minuteOfDay } from './calendar.ts';
import { passEdition } from './edition.ts';
import {
  type Activity,
  type Affordance,
  canMarry,
  court,
  courtingOffer,
  type DecisionRecord,
  glimpsePerson,
  type MarriageCustom,
  MUSLIM_CUSTOM,
  type Outcome,
  type Person,
  type Suggestion,
  spousesOf,
} from './hf.ts';
import { KAHYA } from './people.ts';
import { note, openAsksFor, personOf, promote, type ValleyState } from './valley.ts';

export const INTRO_CUSTOM: MarriageCustom = { ...MUSLIM_CUSTOM };
export const INTRO_IDS = ['ali', 'esma', 'omer'] as const;
export interface IntroductionState {
  from: number;
  until: number;
  status: 'invited' | 'met' | 'missed';
  choices: Record<string, { at: number; action: string; verdict?: string; says?: string }>;
  attendance: Record<string, { start: number; end: number }[]>;
}
export function introductionEligible(s: ValleyState): boolean {
  const [a, b, g] = INTRO_IDS.map((id) => personOf(s, id));
  if (!a || !b || !g?.body.alive || !a.body.alive || !b.body.alive) return false;
  if (
    s.households.find((h) => h.members.includes(a.id)) === s.households.find((h) => h.members.includes(b.id))
  )
    return false;
  // A social spouse reference is still a spouse, even if the absent person has no bonds entry.
  if (
    [a, b].some((p) => spousesOf(p).length || p.social.relationships.some((r) => r.roles.includes('spouse')))
  )
    return false;
  if (
    !b.social.relationships.some((r) => r.otherId === g.id && r.roles.includes('parent')) ||
    !g.social.relationships.some((r) => r.otherId === b.id && r.roles.includes('child'))
  )
    return false;
  return canMarry(a, b, INTRO_CUSTOM, { at: s.minute, lookup: (id: string) => personOf(s, id) }).ok;
}
export function introduce(s: ValleyState): boolean {
  if (!passEdition(s.edition?.id) || s.flags.ended || s.introduction || !introductionEligible(s))
    return false;
  s.introduction = {
    from: s.minute,
    until: s.minute + 2 * DAY,
    status: 'invited',
    choices: {},
    attendance: {},
  };
  for (const id of INTRO_IDS) promote(s, id);
  note(s, {
    at: s.minute,
    kind: 'story',
    text: 'You asked an unmarried adult from Kavak and an unmarried adult from Kuyucu to meet at the Kuyucu house, with her father present. Each can choose their own work instead. Meeting is not consent to marriage.',
    weight: 3,
  });
  return true;
}
export function introductionSuggestion(s: ValleyState, p: Person, at: number): Suggestion | undefined {
  const i = s.introduction;
  return i?.status === 'invited' &&
    at < i.until &&
    INTRO_IDS.some((id) => id === p.id) &&
    (!i.attendance[p.id]?.length || s.brokering?.phase === 'courting')
    ? {
        voiceId: KAHYA,
        action: p.id === 'omer' ? 'supervise-introduction' : 'attend-introduction',
        strength: 0.35,
        appeal: 'belonging',
        since: i.from,
      }
    : undefined;
}
export function introductionOffers(s: ValleyState, p: Person, at: number): Affordance[] {
  const i = s.introduction;
  if (
    i?.status !== 'invited' ||
    at < i.from ||
    at + 4 * HOUR > i.until ||
    !INTRO_IDS.some((id) => id === p.id) ||
    (i.attendance[p.id]?.length && s.brokering?.phase !== 'courting') ||
    !introductionEligible(s)
  )
    return [];
  const { rise, set } = daylight(doyOf(dayOfMinute(at)));
  if (minuteOfDay(at) < rise || minuteOfDay(at) + 4 * HOUR > set) return [];
  const other = personOf(s, p.id === 'ali' ? 'esma' : 'ali');
  if (!other) return [];
  const offer =
    p.id === 'omer'
      ? {
          id: 'intro:omer',
          action: 'supervise-introduction',
          label: 'be present at a family introduction',
          duration: 4 * HOUR,
          effort: 0.1,
          placeId: 'house:kuyucu',
          advertises: { belonging: 0.15 },
          tags: ['social'],
        }
      : courtingOffer(other, {
          id: `intro:${p.id}`,
          duration: 4 * HOUR,
          chaperoned: true,
          placeId: 'house:kuyucu',
        });
  if (p.id !== 'omer') {
    offer.action = 'attend-introduction';
    offer.label = 'travel to a supervised family introduction';
    delete offer.with; // No encounter is claimed before the others actually arrive.
  }
  // Participants wait separately in the public courtyard if the father is absent.
  // The first hour is arrival/preparation, the last is return. Court is applied only
  // for the actual shared middle interval with the father present, never by offer alone.
  return [offer];
}
export function captureIntroduction(
  s: ValleyState,
  p: Person,
  offer: Affordance,
  record: DecisionRecord,
): boolean {
  const i = s.introduction;
  if (i?.status !== 'invited' || !INTRO_IDS.some((id) => id === p.id) || p.now >= i.until) return false;
  const reply =
    record.suggestion?.voiceId === KAHYA
      ? record.suggestion
      : record.suggestions?.find((r) => r.voiceId === KAHYA);
  if (openAsksFor(s, p.id, p.now).some((a) => a.from > i.from) && !offer.id.startsWith('intro:'))
    return false;
  if (!reply && !offer.id.startsWith('intro:')) return false;
  i.choices[p.id] = {
    at: p.now,
    action: offer.action,
    ...(reply ? { verdict: reply.verdict, says: reply.says } : {}),
  };
  return true;
}
export function resolveIntroduction(
  s: ValleyState,
  p: Person,
  a: Activity,
  reason: 'ended' | 'interrupted',
): Outcome | undefined {
  if (!a.affordanceId.startsWith('intro:')) return;
  const out: Outcome = {
    action: a.action,
    affordanceId: a.affordanceId,
    status: reason === 'ended' ? 'completed' : 'interrupted',
    at: p.now,
  };
  const i = s.introduction;
  if (
    i?.status !== 'invited' ||
    reason !== 'ended' ||
    p.now > i.until ||
    a.endsAt > p.now ||
    a.startedAt < i.from
  )
    return out;
  i.attendance[p.id] ??= [];
  const rows = i.attendance[p.id] ?? [];
  if (!rows.some((r) => r.start === a.startedAt + HOUR))
    rows.push({ start: a.startedAt + HOUR, end: a.endsAt - HOUR });
  return out;
}
export function introductionTick(s: ValleyState) {
  const i = s.introduction;
  if (i?.status !== 'invited') return;
  if (introductionEligible(s)) {
    for (const a of i.attendance.ali ?? [])
      for (const b of i.attendance.esma ?? [])
        for (const g of i.attendance.omer ?? []) {
          if (Math.min(a.end, b.end, g.end) - Math.max(a.start, b.start, g.start) < 90) continue;
          const man = personOf(s, 'ali');
          const woman = personOf(s, 'esma');
          if (!man || !woman) return;
          const at = Math.max(s.minute, man.now, woman.now);
          court(man, woman, at);
          // The steward learns only from actual contact, after everyone completed attendance.
          if (
            s.kahyaState.visit?.house === 'kuyucu' &&
            s.kahyaState.visit.arrive <= s.minute &&
            s.kahyaState.visit.leave > s.minute
          ) {
            glimpsePerson(s.kahya, man, Math.max(at, s.kahya.now), 0.5);
            glimpsePerson(s.kahya, woman, Math.max(at, s.kahya.now), 0.5);
          }
          i.status = 'met';
          note(s, {
            at: s.minute,
            kind: 'story',
            text: 'A message from Kuyucu reports that the two adults met with her father present. They chose to spend time together. No proposal or marriage was agreed. Their families may still say no.',
            weight: 3,
          });
          return;
        }
  }
  if (s.minute >= i.until || !introductionEligible(s)) {
    i.status = 'missed';
    note(s, {
      at: s.minute,
      kind: 'story',
      text: 'The introduction ended without a supervised meeting. Work, rest or a different choice took priority. Nobody was promised in marriage.',
      weight: 3,
    });
  }
}
