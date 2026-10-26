/** SCOPE: bodily care only in the explicit alliance edition. The older steward loop
 * ticks awake without food/water and dies before repeat journeys. This edition offers
 * ordinary released HF eat/drink/sleep/rest activities, never rewrites body/preferences.
 * Meals consume real grain (0.01/meal, matching roughly0.03/person-day); water is at
 * the residence and quarry. Walks still occupy the two original eight-hour legs.
 * No time skip, generic cognition, revival, deadline change or old-edition change.
 */
import { type Affordance, begin, decide, finish, tick } from '@adam0white/human-framework';
import { HOUR, minuteOfDay } from './calendar.ts';
import type { ValleyState } from './valley.ts';
export interface StewardCare {
  grain: number;
  eaten: number;
  travelFailed?: boolean;
}
export const stewardBusy = (s: ValleyState) =>
  !!s.kahya.activity && !(s.stewardCare && s.kahya.activity.affordanceId.startsWith('care:'));
export function interruptStewardRoutine(s: ValleyState) {
  const a = s.kahya.activity;
  if (s.stewardCare && a?.affordanceId.startsWith('care:'))
    finish(s.kahya, {
      at: s.kahya.now,
      affordanceId: a.affordanceId,
      action: a.action,
      status: 'interrupted',
    });
}
export function stewardTo(s: ValleyState, to: number) {
  const p = s.kahya;
  const care = s.stewardCare;
  if (!care) return;
  while (p.now < to) {
    const j = s.pass?.journey;
    const passWalking =
      j && !j.returned && !j.failed && (p.now < j.arrive || (p.now >= j.leave && p.now < j.back));
    const v = s.kahyaState.visit;
    const localWalking =
      v &&
      v.house !== 'cam' &&
      !care.travelFailed &&
      (p.now < v.arrive || (p.now >= v.leave && p.now < v.back));
    const walking = passWalking || localWalking;
    const walkEnd =
      passWalking && j
        ? p.now < j.arrive
          ? j.arrive
          : j.back
        : localWalking && v
          ? p.now < v.arrive
            ? v.arrive
            : v.back
          : undefined;
    const boundary =
      j && !j.returned && !j.failed && p.now < j.leave && p.now >= j.arrive
        ? j.leave
        : v && v.house !== 'cam' && p.now >= v.arrive && p.now < v.leave
          ? v.leave
          : Infinity;
    if (walking && p.activity && p.activity.action !== 'walk')
      finish(p, {
        at: p.now,
        affordanceId: p.activity.affordanceId,
        action: p.activity.action,
        status: 'interrupted',
      });
    if (!p.activity && p.body.alive) {
      const mod = minuteOfDay(p.now);
      const away = !!(s.kahyaState.visit && s.kahyaState.visit.back > p.now);
      const food = away ? care.grain : care.grain + s.agha.granary;
      const home = away
        ? s.kahyaState.visit?.house === 'cam'
          ? 'cam'
          : `house:${s.kahyaState.visit?.house}`
        : 'residence';
      const offers: Affordance[] = walking
        ? [
            {
              id: `care:walk:${walkEnd}`,
              action: 'walk',
              label: passWalking ? 'walk over the pass' : 'walk along the lane',
              duration: (walkEnd ?? to) - p.now,
              effort: 0.25,
              placeId: passWalking ? 'pass' : 'lane',
              advertises: {},
              tags: ['work'],
            },
          ]
        : [
            ...(food >= 0.01
              ? [
                  {
                    id: 'care:eat',
                    action: 'eat',
                    label: 'eat from the provisions',
                    duration: 30,
                    effort: 0,
                    placeId: home,
                    advertises: { food: 0.6 },
                    tags: ['eat'],
                  },
                ]
              : []),
            {
              id: 'care:drink',
              action: 'drink',
              label: 'drink water at the shelter',
              duration: 30,
              effort: 0,
              placeId: home,
              advertises: { water: 0.6 },
              tags: ['drink'],
            },
            ...(mod >= 22 * HOUR || mod < 6 * HOUR || p.body.sleepPressure > 0.7
              ? [
                  {
                    id: 'care:sleep',
                    action: 'sleep',
                    label: 'sleep at the shelter',
                    duration: Math.min(8 * HOUR, boundary - p.now),
                    effort: 0,
                    mode: 'sleep' as const,
                    placeId: home,
                    advertises: { sleep: 0.8, rest: 0.4 },
                    tags: ['sleep'],
                  },
                ]
              : []),
            {
              id: 'care:rest',
              action: 'rest',
              label: 'rest at the shelter',
              duration: 60,
              effort: 0,
              placeId: home,
              advertises: { rest: 0.3 },
              tags: ['rest'],
            },
          ];
      const record = decide(p, offers);
      const offer = offers.find((a) => a.id === record.chosenAffordanceId);
      if (offer) begin(p, offer, record);
      if (walking && !p.activity) {
        if (passWalking && j) j.failed = true;
        else care.travelFailed = true;
      }
    }
    if (walking && !p.body.alive && j && passWalking) j.failed = true;
    const a = p.activity;
    const until = Math.min(to, a?.endsAt ?? to, boundary);
    tick(p, until);
    if (a && p.activity && a.endsAt <= p.now) {
      let food = 0;
      if (a.affordanceId === 'care:eat') {
        const packed = Math.min(care.grain, 0.01);
        care.grain -= packed;
        const away = !!(s.kahyaState.visit && s.kahyaState.visit.back > p.now);
        const fromStore = away ? 0 : Math.min(Math.max(0, 0.01 - packed), s.agha.granary);
        s.agha.granary -= fromStore;
        food = packed + fromStore >= 0.01 - 1e-10 ? 0.6 : 0;
        care.eaten += packed + fromStore;
      }
      finish(p, {
        at: p.now,
        affordanceId: a.affordanceId,
        action: a.action,
        status: 'completed',
        needs:
          a.affordanceId === 'care:eat' ? { food } : a.affordanceId === 'care:drink' ? { water: 0.6 } : {},
      });
    }
  }
}
