/** SCOPE: repeated supervised meetings, an actual guardian stance, independent proposals
 * and a later host ceremony, using the released partnering contract and sourced custom.
 * Presence is not approval. HF owns decisions, warmth and readiness. The host owns the
 * two-day invitation, one provision, six-grain sponsored bridal gift and physical venue.
 * Those costs are authored conventions, not religious rulings or certified ceremony.
 * No new actor, norm, private preference edit, compatibility display or missing guardian
 * interpretation. Research: released partnering SCOPE; research/marriage-sources.md1–6/10.
 */
import {
  type Activity,
  type Affordance,
  betroth,
  canMarry,
  courtshipStage,
  familyVoices,
  marry,
  type Outcome,
  type Person,
  proposalOffers,
  proposeOffer,
  type Suggestion,
} from '@adam0white/human-framework';
import { DAY, HOUR } from './calendar.ts';
import { allianceEdition } from './edition.ts';
import {
  INTRO_CUSTOM,
  INTRO_IDS,
  type IntroductionState,
  introduce,
  introductionEligible,
} from './introductions.ts';
import { hasOfficeCard, note, personOf, promote, type ValleyState } from './valley.ts';

export type BrokerChoice = 'meeting' | 'proposal' | 'ceremony';
type Phase =
  | 'courting'
  | 'guardian'
  | 'proposal'
  | 'answer'
  | 'engaged'
  | 'ceremony'
  | 'refused'
  | 'expired'
  | 'married';
export interface BrokeringState {
  phase: Phase;
  round: number;
  from: number;
  until: number;
  guardian?: { at: number; stance: 'approved' | 'refused' };
  invitations: IntroductionState[];
  decisions: { at: number; person: string; action: string; round: number }[];
  ceremony: Record<string, { start: number; end: number; action: string }>;
  giftEscrow: number;
  gift?: { person: string; grain: number; at: number };
}
const emit = (s: ValleyState, text: string) => note(s, { at: s.minute, kind: 'story', text, weight: 3 });

import { interruptStewardRoutine, stewardBusy } from './steward.ts';
import { deliveryTripReserved } from './terms.ts';

const busy = (s: ValleyState) =>
  deliveryTripReserved(s) || stewardBusy(s) || !!(s.kahyaState.visit && s.kahyaState.visit.back > s.minute);
export function brokerReady(s: ValleyState): boolean {
  return (
    introductionEligible(s) &&
    ['ali', 'esma'].every((id, index) => {
      const p = personOf(s, id);
      return !!p && courtshipStage(p, index ? 'ali' : 'esma', s.minute) === 'ready';
    })
  );
}
export function brokerUnavailable(s: ValleyState, choice: BrokerChoice): string | null {
  if (!allianceEdition(s.edition?.id) || s.flags.ended)
    return 'This term is not open for family arrangements.';
  if (!s.kahya.body.alive) return 'The steward cannot make this journey.';
  if (busy(s)) return 'Return from your current visit or hosting first.';
  if (hasOfficeCard(s)) return 'Answer the invitation or current decision first.';
  if (!introductionEligible(s))
    return 'The recorded adults and guardian are not eligible for this arrangement.';
  if (s.introduction?.status === 'invited') return 'Let the current introduction end first.';
  const old = s.brokering;
  if (old && ['guardian', 'proposal', 'answer', 'ceremony', 'refused', 'married'].includes(old.phase))
    return 'The current family outcome does not permit another arrangement.';
  if (choice === 'proposal' && (!brokerReady(s) || old?.phase === 'engaged'))
    return 'The adults are not ready for a new proposal discussion.';
  if (choice === 'ceremony' && (old?.phase !== 'engaged' || old.guardian?.stance !== 'approved'))
    return 'A completed mutual proposal and her father’s explicit approval must come first.';
  if (choice === 'meeting' && old?.phase === 'engaged') return 'The adults already accepted a proposal.';
  if (s.agha.granary < (choice === 'ceremony' ? 7 : 1))
    return 'The granary cannot supply the provisions and any bridal gift.';
  return null;
}
export function brokerChoice(s: ValleyState, choice: BrokerChoice): boolean {
  if (brokerUnavailable(s, choice)) return false;
  const old = s.brokering;
  const cost = choice === 'ceremony' ? 7 : 1;
  interruptStewardRoutine(s);
  if (s.stewardCare) delete s.stewardCare.travelFailed;
  s.agha.granary -= cost;
  if (s.stewardCare) s.stewardCare.grain += 1;
  s.kahyaState.visit = {
    house: 'kuyucu',
    arrive: s.minute + HOUR,
    leave: s.minute + 2 * DAY - HOUR,
    back: s.minute + 2 * DAY,
  };
  const b: BrokeringState = old ?? {
    phase: 'courting',
    round: 0,
    from: s.minute,
    until: s.minute,
    invitations: [],
    decisions: [],
    ceremony: {},
    giftEscrow: 0,
  };
  s.brokering = b;
  b.round++;
  b.from = s.minute;
  b.until = s.minute + 2 * DAY;
  b.ceremony = {};
  for (const id of INTRO_IDS) promote(s, id);
  if (choice === 'meeting') {
    if (s.introduction) b.invitations.push(structuredClone(s.introduction));
    delete s.introduction;
    introduce(s);
    const invited = (s as ValleyState).introduction;
    if (invited) {
      invited.from = s.minute + HOUR;
      invited.until = s.minute + 2 * DAY - HOUR;
    }
    b.phase = 'courting';
    emit(
      s,
      'You packed provisions and set out for Kuyucu to host another supervised meeting. Two days are set aside. The adults and her father still choose their own work and rest. Each completed meeting gives them time to get to know each other; it promises no marriage.',
    );
  } else if (choice === 'proposal') {
    b.phase = 'guardian';
    delete b.guardian;
    emit(
      s,
      'You packed provisions and set out for a family discussion at Kuyucu. Her father must give his own answer. The adults must each decide separately. Nobody is promised in marriage by attending.',
    );
  } else {
    b.phase = 'ceremony';
    b.giftEscrow = 6;
    emit(
      s,
      'You brought provisions and set aside a sponsored bridal gift for the woman. You will stay at Kuyucu for two days. Both adults must confirm the marriage and gift separately, with her father and you present. Either may decline. An unused gift returns to the granary; the provisions and time remain spent.',
    );
  }
  return true;
}
const prefix = (b: BrokeringState) => `broker:${b.round}:${b.phase}:`;
export function brokerOffers(s: ValleyState, p: Person, at: number): Affordance[] {
  const b = s.brokering;
  if (
    s.flags.ended ||
    !b ||
    at < (s.kahyaState.visit?.arrive ?? b.from) ||
    at + (b.phase === 'ceremony' ? 4 : 2) * HOUR > (s.kahyaState.visit?.leave ?? b.until) ||
    !introductionEligible(s)
  )
    return [];
  const man = personOf(s, 'ali');
  const woman = personOf(s, 'esma');
  if (!man || !woman) return [];
  const id = prefix(b);
  if (b.phase === 'guardian' && p.id === 'omer')
    return [
      {
        id: `${id}approve`,
        action: 'approve-match',
        label: 'approve this proposed match',
        duration: 2 * HOUR,
        effort: 0.1,
        placeId: 'house:kuyucu',
        advertises: { belonging: 0.1, meaning: 0.1 },
        tags: ['social'],
      },
      {
        id: `${id}refuse`,
        action: 'withhold-match',
        label: 'withhold approval of this match',
        duration: 2 * HOUR,
        effort: 0.1,
        placeId: 'house:kuyucu',
        advertises: {},
        tags: ['social'],
      },
    ];
  if (b.phase === 'proposal' && p.id === 'ali') {
    const offer = proposeOffer(p, woman, { guardian: 'consented', lookup: (pid) => personOf(s, pid) });
    // A supervised message is carried at this visit, not a joint activity before assent.
    delete offer.with;
    return [{ ...offer, id: `${id}propose`, duration: 2 * HOUR, placeId: 'house:kuyucu' }];
  }
  if (
    (b.phase === 'answer' && p.id === 'esma') ||
    (b.phase === 'ceremony' && ['ali', 'esma'].includes(p.id) && !b.ceremony[p.id])
  ) {
    return proposalOffers(p, p.id === 'ali' ? woman : man, {
      guardian: 'consented',
      lookup: (pid) => personOf(s, pid),
    }).map((offer, index) => ({
      ...offer,
      id: `${id}${index ? 'decline' : 'accept'}`,
      duration: b.phase === 'ceremony' ? 4 * HOUR : 2 * HOUR,
      placeId: 'house:kuyucu',
      ...(b.phase === 'ceremony'
        ? { label: index ? 'decline the marriage' : 'confirm the marriage and sponsored bridal gift' }
        : {}),
    }));
  }
  if (b.phase === 'ceremony' && p.id === 'omer' && !b.ceremony.omer)
    return [
      {
        id: `${id}witness`,
        action: 'witness-marriage',
        label: 'attend and witness the family ceremony',
        duration: 4 * HOUR,
        effort: 0.1,
        placeId: 'house:kuyucu',
        advertises: { belonging: 0.1, meaning: 0.1 },
        tags: ['social'],
      },
      {
        id: `${id}withdraw`,
        action: 'withhold-match',
        label: 'withdraw approval before the ceremony',
        duration: 2 * HOUR,
        effort: 0.1,
        placeId: 'house:kuyucu',
        advertises: {},
        tags: ['social'],
      },
    ];
  return [];
}
export function brokerVoices(s: ValleyState, p: Person, at: number): Suggestion[] {
  const b = s.brokering;
  if (
    b?.guardian?.stance !== 'approved' ||
    !['answer', 'ceremony'].includes(b.phase) ||
    !['ali', 'esma'].includes(p.id)
  )
    return [];
  const offers = brokerOffers(s, p, at);
  return offers.length === 2
    ? familyVoices([offers[0] as Affordance, offers[1] as Affordance], [{ voiceId: 'omer', approval: 1 }])
    : [];
}
function close(s: ValleyState, phase: 'refused' | 'expired') {
  const b = s.brokering;
  if (!b) return;
  s.agha.granary += b.giftEscrow;
  b.giftEscrow = 0;
  b.phase = phase;
  emit(
    s,
    phase === 'refused'
      ? 'The family discussion ended with a refusal. No marriage was recorded. Nobody’s presence supplied another person’s consent.'
      : 'The family invitation ended without all the required completed answers. No marriage was recorded. Any untransferred bridal gift returned to the granary.',
  );
}
export function resolveBroker(
  s: ValleyState,
  p: Person,
  a: Activity,
  reason: 'ended' | 'interrupted',
): Outcome | undefined {
  if (!a.affordanceId.startsWith('broker:')) return;
  const out: Outcome = {
    action: a.action,
    affordanceId: a.affordanceId,
    status: reason === 'ended' ? 'completed' : 'interrupted',
    at: p.now,
  };
  const b = s.brokering;
  if (
    s.flags.ended ||
    !b ||
    !a.affordanceId.startsWith(prefix(b)) ||
    a.startedAt < b.from ||
    reason !== 'ended' ||
    a.endsAt > p.now ||
    p.now > b.until ||
    !introductionEligible(s)
  )
    return out;
  b.decisions.push({ at: p.now, person: p.id, action: a.action, round: b.round });
  if (a.action === 'withhold-match' || a.action === 'decline-proposal') {
    if (p.id === 'omer') b.guardian = { at: p.now, stance: 'refused' };
    close(s, 'refused');
  } else if (b.phase === 'guardian' && p.id === 'omer' && a.action === 'approve-match') {
    b.guardian = { at: p.now, stance: 'approved' };
    b.phase = 'proposal';
    emit(
      s,
      'Her father gave his approval of the proposed match. That is his answer alone. Both adults still have their own decisions to make.',
    );
  } else if (
    b.phase === 'proposal' &&
    p.id === 'ali' &&
    a.action === 'propose' &&
    b.guardian?.stance === 'approved'
  ) {
    b.phase = 'answer';
    emit(
      s,
      'The adult from Kavak made a marriage proposal. A proposal is not acceptance. The adult from Kuyucu can decline or leave the question pending.',
    );
  } else if (
    b.phase === 'answer' &&
    p.id === 'esma' &&
    a.action === 'accept-proposal' &&
    b.guardian?.stance === 'approved'
  ) {
    const man = personOf(s, 'ali');
    const woman = personOf(s, 'esma');
    if (
      man &&
      woman &&
      canMarry(man, woman, INTRO_CUSTOM, {
        at: p.now,
        guardian: 'consented',
        lookup: (pid) => personOf(s, pid),
      }).ok
    ) {
      betroth(man, woman, Math.max(man.now, woman.now, p.now));
      b.phase = 'engaged';
      emit(
        s,
        'The proposal was accepted after her father’s recorded approval. The adults are engaged. A later family ceremony still needs their separate confirmation. They have not married.',
      );
    }
  } else if (
    b.phase === 'ceremony' &&
    ((['ali', 'esma'].includes(p.id) && a.action === 'accept-proposal') ||
      (p.id === 'omer' && a.action === 'witness-marriage'))
  ) {
    b.ceremony[p.id] = { start: a.startedAt + HOUR, end: a.endsAt - HOUR, action: a.action };
  }
  return out;
}
export function brokerTick(s: ValleyState) {
  const b = s.brokering;
  if (
    b?.phase === 'courting' &&
    s.introduction?.status === 'met' &&
    s.kahyaState.visit?.house === 'kuyucu' &&
    s.minute + 4 * HOUR < s.kahyaState.visit.leave &&
    !brokerReady(s)
  ) {
    b.invitations.push(structuredClone(s.introduction));
    delete s.introduction;
    introduce(s);
    const next = (s as ValleyState).introduction;
    if (next) next.until = s.kahyaState.visit.leave;
  }
  if (!b || !['guardian', 'proposal', 'answer', 'ceremony'].includes(b.phase)) return;
  if (!s.kahya.body.alive || s.stewardCare?.travelFailed || !introductionEligible(s)) {
    close(s, 'expired');
    return;
  }
  if (b.phase === 'ceremony' && b.guardian?.stance === 'approved' && b.giftEscrow === 6) {
    const rows = INTRO_IDS.map((id) => b.ceremony[id]);
    const v = s.kahyaState.visit;
    if (
      rows.every((r) => !!r) &&
      v?.house === 'kuyucu' &&
      Math.min(...rows.map((r) => r?.end ?? -Infinity), v.leave) -
        Math.max(...rows.map((r) => r?.start ?? Infinity), v.arrive) >=
        90
    ) {
      const man = personOf(s, 'ali');
      const woman = personOf(s, 'esma');
      if (
        man &&
        woman &&
        marry(man, woman, Math.max(s.minute, man.now, woman.now), INTRO_CUSTOM, {
          guardian: 'consented',
          lookup: (pid) => personOf(s, pid),
        }).ok
      ) {
        b.gift = { person: woman.id, grain: b.giftEscrow, at: s.minute };
        b.giftEscrow = 0;
        b.phase = 'married';
        emit(
          s,
          'Both adults confirmed the marriage and bridal gift at the attended family ceremony, with her father and the steward present. The gift belongs to the woman. Their marriage is now recorded.',
        );
        return;
      }
    }
  }
  if (s.minute >= b.until) close(s, 'expired');
}
