/** SCOPE: bodily care only in the explicit alliance edition. The older steward loop
 * ticks awake without food/water and dies before repeat journeys. This edition offers
 * ordinary released HF eat/drink/sleep/rest activities, never rewrites body/preferences.
 * Meals consume real grain (0.01/meal, matching roughly0.03/person-day); water is at
 * the residence and quarry. Walks still occupy the two original eight-hour legs.
 * No time skip, generic cognition, revival, deadline change or old-edition change.
 */

import { HOUR, minuteOfDay } from './calendar.ts';
import { type Affordance, finish } from './hf.ts';
import {
  captureTermsSteward,
  deliveryAway,
  deliveryLive,
  resolveTermsSteward,
  termsStewardOffers,
  termsStewardPlace,
} from './terms.ts';
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
/** Offers are served in the same community Run as residents. */
export function stewardOffers(s: ValleyState, at = s.kahya.now): Affordance[] {
  const p = s.kahya,
    care = s.stewardCare;
  if (!care || !p.body.alive) return [];
  const delivery = deliveryLive(s),
    j = s.pass?.journey,
    v = s.kahyaState.visit;
  const passWalking = !!(j && !j.returned && !j.failed && (at < j.arrive || (at >= j.leave && at < j.back)));
  const localWalking = !!(
    v &&
    v.house !== 'cam' &&
    !care.travelFailed &&
    (at < v.arrive || (at >= v.leave && at < v.back))
  );
  if (passWalking || localWalking) {
    const end =
      passWalking && j
        ? at < j.arrive
          ? j.arrive
          : j.back
        : v
          ? at < v.arrive
            ? v.arrive
            : v.back
          : at + 30;
    return [
      {
        id: `care:walk:${end}`,
        action: 'walk',
        label: passWalking ? 'walk over the pass' : 'walk along the lane',
        duration: passWalking ? 8 * HOUR : (v?.walk ?? Math.max(1, end - at)),
        effort: 0.25,
        placeId: passWalking ? 'pass' : 'lane',
        advertises: {},
        tags: ['work'],
      },
    ];
  }
  const away = deliveryAway(s) || !!(v && v.back > at),
    food = away ? care.grain : care.grain + s.agha.granary;
  const home = delivery ? termsStewardPlace(s) : away ? `house:${v?.house}` : 'residence';
  const mod = minuteOfDay(at);
  const out: Affordance[] = [
    {
      id: 'care:relieve',
      action: 'relieve',
      label: 'use the privy',
      duration: 5,
      effort: 0,
      placeId: home,
      advertises: { relief: 1 },
      tags: ['relief'],
    },
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
    ...(!delivery || home === 'residence'
      ? [
          {
            id: 'care:drink',
            action: 'drink',
            label: 'drink at the shelter',
            duration: 30,
            effort: 0,
            placeId: home,
            advertises: { water: 0.6 },
            tags: ['drink'],
          },
        ]
      : []),
    ...(mod >= 22 * HOUR || mod < 6 * HOUR || p.body.sleepPressure > 0.7
      ? [
          {
            id: 'care:sleep',
            action: 'sleep',
            label: 'sleep at the shelter',
            duration: 8 * HOUR,
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
  if (delivery) out.push(...termsStewardOffers(s, at));
  return out;
}
export function captureSteward(
  s: ValleyState,
  offer: Affordance,
  record: import('./hf.ts').DecisionRecord,
): void {
  captureTermsSteward(s, offer, record);
  const v = s.kahyaState.visit;
  if (v && offer.id.startsWith('care:walk:') && offer.placeId === 'lane') {
    if (!v.outboundStarted) {
      const delta = s.kahya.now + offer.duration - v.arrive;
      v.arrive += delta;
      v.leave += delta;
      v.back += delta;
      v.outboundStarted = true;
    } else if (s.kahya.now >= v.leave && !v.returnStarted) {
      v.back = s.kahya.now + offer.duration;
      v.returnStarted = true;
    }
  }
}
export function resolveSteward(
  s: ValleyState,
  a: import('./hf.ts').Activity,
  reason: 'ended' | 'interrupted',
): import('./hf.ts').Outcome {
  const p = s.kahya,
    care = s.stewardCare;
  const terms = resolveTermsSteward(s, a, reason);
  if (terms) return terms;
  const v = s.kahyaState.visit;
  if (reason === 'ended' && a.action === 'walk' && a.affordance.placeId === 'lane' && v) {
    if (!v.returnStarted) {
      s.kahyaState.place = `house:${v.house}`;
      s.kahyaState.seen[v.house] = p.now;
    } else s.kahyaState.place = 'residence';
  }
  let food = 0;
  if (care && a.affordanceId === 'care:eat' && reason === 'ended') {
    const packed = Math.min(care.grain, 0.01);
    care.grain -= packed;
    const away = deliveryAway(s) || !!(s.kahyaState.visit && s.kahyaState.visit.back > p.now);
    const store = away ? 0 : Math.min(Math.max(0, 0.01 - packed), s.agha.granary);
    s.agha.granary -= store;
    care.eaten += packed + store;
    food = packed + store >= 0.01 - 1e-10 ? 0.6 : 0;
  }
  return {
    at: p.now,
    affordanceId: a.affordanceId,
    action: a.action,
    status: reason === 'ended' ? 'completed' : 'interrupted',
    needs:
      a.affordanceId === 'care:eat'
        ? { food }
        : a.affordanceId === 'care:drink'
          ? { water: 0.6 }
          : a.affordanceId === 'care:relieve'
            ? { relief: 1 }
            : {},
  };
}
