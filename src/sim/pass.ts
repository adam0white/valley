/** SCOPE: one same-era adjacent quarry, steward travel, provisions and finite stone barter.
 * The world keeps advancing while the steward is away. No new people, food source,
 * private knowledge or portable identity mapping. Costs (1 provision, 6 barter,
 * 8 hours each way, two days away, 12 mill-hours/load) are authored conventions.
 */

import type { AllianceState } from './alliance.ts';
import { DAY, HOUR } from './calendar.ts';
import { allianceEdition, passEdition } from './edition.ts';
import { type Affordance, begin, decide } from './hf.ts';
import { interruptStewardRoutine, stewardBusy } from './steward.ts';
import { deliveryTripReserved } from './terms.ts';
import { hasOfficeCard, note, V, type ValleyState } from './valley.ts';

export interface PassState {
  alliance?: AllianceState;
  stock: number;
  grainReceived: number;
  stone: number;
  journey?: {
    from: number;
    arrive: number;
    leave: number;
    back: number;
    seen?: boolean;
    outwardArrived?: boolean;
    homeArrived?: boolean;
    cargo: number;
    grain: number;
    returned?: boolean;
    failed?: boolean;
  };
}
export function passChoice(s: ValleyState, choice: 'depart' | 'buy' | 'deliver'): boolean {
  if (!passEdition(s.edition?.id) || s.flags.ended || deliveryTripReserved(s)) return false;
  if (s.stewardCare && hasOfficeCard(s)) return false;
  const p = s.pass;
  if (!p) return false;
  const j = p.journey;
  if (choice === 'buy') {
    if (allianceEdition(s.edition?.id)) return false;
    if (
      !j?.seen ||
      j.failed ||
      j.returned ||
      s.minute < j.arrive ||
      s.minute >= j.leave ||
      j.cargo ||
      p.stock < 1 ||
      j.grain < 6
    )
      return false;
    j.grain -= 6;
    p.grainReceived += 6;
    p.stock--;
    j.cargo = 1;
    note(s, {
      at: s.minute,
      kind: 'story',
      text: 'You exchanged a sack from the granary for a dressed stone at Çam quarry. The stone must still be carried home. The payment to the landowner is unchanged.',
      weight: 3,
    });
    return true;
  }
  if (choice === 'deliver') {
    if ((j && !j.returned) || p.stone < 1 || !s.agha.millOpen || s.agha.mill >= V.millHours) return false;
    p.stone--;
    s.agha.mill = Math.min(V.millHours, s.agha.mill + 12);
    note(s, {
      at: s.minute,
      kind: 'work',
      text: `You delivered a dressed stone to the mill. It replaces a little carrying and dressing. ${s.agha.mill < V.millHours ? 'The remaining work still needs the valley’s labour.' : 'The mill work is complete.'}`,
      weight: 3,
    });
    return true;
  }
  if (
    choice !== 'depart' ||
    (j && !j.returned) ||
    (s.kahyaState.visit && s.kahyaState.visit.back > s.minute) ||
    stewardBusy(s) ||
    s.agha.granary < 7
  )
    return false;
  const offer: Affordance = {
    id: 'cam-journey',
    action: 'walk',
    label: 'walk over the pass and carry goods home',
    duration: s.stewardCare ? 8 * HOUR : 2 * DAY,
    effort: 0.25,
    placeId: 'pass',
    advertises: {},
    tags: ['work'],
  };
  interruptStewardRoutine(s);
  const record = decide(s.kahya, [offer]);
  if (record.chosenAffordanceId !== offer.id) return false;
  if (!begin(s.kahya, offer, record)) return false;
  s.agha.granary -= 7;
  if (s.stewardCare) s.stewardCare.grain += 1;
  p.journey = {
    from: s.minute,
    arrive: s.minute + 8 * HOUR,
    leave: s.minute + 2 * DAY - 8 * HOUR,
    back: s.minute + 2 * DAY,
    cargo: 0,
    grain: 6,
  };
  s.kahyaState.visit = {
    house: 'cam',
    arrive: p.journey.arrive,
    leave: p.journey.leave,
    back: p.journey.back,
  };
  note(s, {
    at: s.minute,
    kind: 'visit',
    text: allianceEdition(s.edition?.id)
      ? 'You took provisions and a sack from the granary and set out over the pass for Çam. You will be away for two days. Stone is available only through the public road agreement: six grain, twelve useful hours of voluntary repairs, and a later journey to collect within fourteen days. You can decline. The fields, households and rider will not wait.'
      : 'You took provisions and a barter sack from the granary and set out over the pass for Çam. You will be away for two days. The fields, households and rider will not wait. A sack can buy a stone load if the quarry has one when you arrive.',
    weight: 3,
  });
  return true;
}
export function passTick(s: ValleyState) {
  const p = s.pass;
  const j = p?.journey;
  if (!p || !j || j.returned) return;
  if (!j.failed && !j.seen && (s.stewardCare ? j.outwardArrived : s.minute >= j.arrive)) {
    j.seen = true;
    note(s, {
      at: s.minute,
      kind: 'visit',
      text: `You reached Çam quarry in the neighbouring valley. The path descends from the same ridge. ${p.stock ? (allianceEdition(s.edition?.id) ? 'Dressed stones are available only through the public road agreement. A sack alone cannot buy a load. Read the terms before spending grain.' : 'Dressed stones lie beside the public weighing shelter. A sack buys one load.') : 'The stone stacks are empty.'} No household food is for sale here.`,
      weight: 3,
    });
  }
  if (s.stewardCare ? j.homeArrived : s.minute >= j.back) {
    if (j.failed) {
      j.returned = true;
      note(s, {
        at: s.minute,
        kind: 'visit',
        text: 'You could not complete the pass journey. The load has not reached the residence.',
        weight: 3,
      });
      return;
    }
    p.stone += j.cargo;
    s.agha.granary += j.grain;
    j.grain = 0;
    j.cargo = 0;
    j.returned = true;
    note(s, {
      at: s.minute,
      kind: 'visit',
      text: 'You returned over the pass. Any stone you brought is now beside the residence. The mill can receive it when work opens.',
      weight: 3,
    });
  }
}
