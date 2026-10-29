/** Authored Valley offers and actual HF4 lifecycle receipts. HF owns all family changes. */
import * as HF from '@adam0white/human-framework';
import {
  bridgeAt,
  bridgeContext,
  bridgeDefer,
  bridgeInput,
  bridgeKinEvidence,
  type Community,
  type MarriageCustom,
  serve,
} from './hf.ts';
import {
  type Activity,
  type Affordance,
  authoringOf,
  bindPerson,
  bindPersonActivityView,
  createPerson,
  type Person,
  type PersonSpec,
  personRun,
  pregnancyDue,
  type Suggestion,
} from './hf-person.ts';

const MS = 60000;
type Lifecycle = HF.Payloads['lifecycle.received'];
type Completion = { person: string; activity: Activity; evidenceId: string; endedAt: number };
export const MUSLIM_CUSTOM: MarriageCustom = {
  id: 'muslim',
  minAgeYears: 18,
  forbiddenKin: [
    'spouse',
    'parent',
    'child',
    'sibling',
    'grandparent',
    'grandchild',
    'aunt-uncle',
    'niece-nephew',
    'step-parent',
    'step-child',
    'parent-in-law',
    'child-in-law',
  ],
  guardianForBride: true,
  mourningDays: { widow: 130, widower: 0 },
  maxSpouses: 1,
  pairing: 'opposite-sex',
};
export const MUSLIM_CUSTOM_DATA = {
  ...MUSLIM_CUSTOM,
  provenance: { kind: 'authored-world', author: 'valley', ruleId: 'muslim', edition: 'valley-hf48' },
  engineeringPremises: [
    {
      kind: 'assumption',
      ref: 'Valley supervised adult introductions: minimum age18 and one spouse; docs/design.md',
    },
  ],
} as HF.Definitions['marriageCustoms'][number];
function basis(c: Community, id: string): Lifecycle['basis'] {
  return { evidence: { kind: 'evidence', id }, worldRevision: c.revision ?? 0 };
}
function submit(c: Community, payload: Lifecycle, minutes: number): void {
  bridgeDefer(c, 'lifecycle.received', payload, minutes);
}

function frameKey(c: Community, time: number): string {
  return `${Math.round(time * MS)}:${c.ingress}:${c.next}:${c.revision ?? 0}`;
}
export const FAMILY_ACTIONS = new Set([
  'court',
  'attend-introduction',
  'propose',
  'accept-proposal',
  'decline-proposal',
  'approve-match',
  'withhold-match',
  'witness-marriage',
]);
/** Rebuild legacy host receipts once from the supplied archive. */
export function familyReceiptsFromArchive(archive: HF.DeepReadonly<HF.RunArchive>): Completion[] {
  const offers = new Map<string, HF.DeepReadonly<HF.Offer>>(),
    activities = new Map<string, HF.DeepReadonly<HF.Offer>>();
  const projected: Completion[] = [];
  for (const transaction of archive.history) {
    for (const input of transaction.inputs) {
      if (input.kind === 'offers.received')
        for (const offer of input.payload.offers)
          offers.set(`${input.payload.person}:${input.payload.revision}:${offer.id}`, offer);
      if (input.kind === 'action.resolved' && input.payload.outcome?.status === 'completed') {
        const out = input.payload.outcome,
          offer = activities.get(input.payload.activityId);
        if (offer && FAMILY_ACTIONS.has(offer.actionId))
          projected.push({
            person: input.payload.person,
            evidenceId: out.evidenceId,
            endedAt: out.end / MS,
            activity: {
              action: offer.actionId,
              targetId: offer.target,
              startedAt: out.start / MS,
              endsAt: out.end / MS,
              affordanceId: offer.id,
              affordance: { with: [...offer.participants] },
            } as Activity,
          });
      }
    }
    if (transaction.boundary.type === 'world-required')
      for (const request of transaction.boundary.requests)
        if (request.kind === 'action' && request.stage === 'start') {
          const offer = offers.get(`${request.person}:${request.offerRevision}:${request.offerId}`);
          if (offer) activities.set(request.activityId, offer);
        }
  }
  return projected;
}
function completed(c: Community, person: string, action: string, other?: string): Completion | undefined {
  const matches = (r: Completion) =>
    r.person === person &&
    r.activity.action === action &&
    (other === undefined || r.activity.targetId === other || r.activity.affordance.with?.includes(other));
  const recent = (c.staging ?? c).completed?.findLast(matches);
  return recent ?? (c.staging ?? c).familyCompleted?.findLast(matches);
}
export function marry(
  a: Person,
  b: Person,
  time: number,
  custom: MarriageCustom = MUSLIM_CUSTOM,
  options: { guardian?: string; lookup?: unknown } = {},
): { ok: boolean; reason?: string } {
  if (!personRun(a)) {
    for (const [p, q] of [
      [a, b],
      [b, a],
    ] as const) {
      p.social.relationships.push({
        otherId: q.id,
        roles: ['spouse'],
        affection: 0.75,
        trust: 0.8,
        respect: 0.5,
        familiarity: 0.95,
        ledger: 0,
        lastInteraction: time,
      });
      p.bonds ??= { courtships: [], marriages: [] };
      const bonds = p.bonds;
      bonds.marriages.push({
        spouseId: q.id,
        since: time,
        mourningDays: p.life.sex === 'female' ? custom.mourningDays.widow : custom.mourningDays.widower,
      });
    }
    return { ok: true };
  }
  const c = bridgeContext(a),
    accepted = completed(c, a.id, 'accept-proposal', b.id) ?? completed(c, b.id, 'accept-proposal', a.id);
  const laterDecline = [
    [a, b],
    [b, a],
  ].some(([actor, other]) => {
    if (!actor || !other) return false;
    const denied = completed(c, actor.id, 'decline-proposal', other.id),
      agreed = completed(c, actor.id, 'accept-proposal', other.id);
    return denied && (!agreed || denied.endedAt > agreed.endedAt);
  });
  if (laterDecline) return { ok: false, reason: 'A later completed answer declined this proposal.' };
  if (!accepted) return { ok: false, reason: 'No completed acceptance of this proposal is recorded.' };
  const proposal = completed(c, a.id, 'propose', b.id) ?? completed(c, b.id, 'propose', a.id);
  if (!proposal || accepted.activity.startedAt < proposal.activity.endsAt)
    return { ok: false, reason: 'No completed proposal precedes this acceptance.' };
  const first = completed(c, a.id, 'accept-proposal', b.id),
    second = completed(c, b.id, 'accept-proposal', a.id);
  if (!first || !second) return { ok: false, reason: 'Both adults must complete their own confirmation.' };
  if (
    Math.min(first.activity.endsAt, second.activity.endsAt) -
      Math.max(first.activity.startedAt, second.activity.startedAt) <
    90
  )
    return { ok: false, reason: 'The adults have not completed the same attended ceremony.' };
  if (c.staging) return { ok: false, reason: 'Marriage must follow settled confirmations.' };
  const scopeId = `kin:${[a.id, b.id].sort().join(':')}`;
  const id = `marriage:${a.id}:${b.id}:${c.next}`;
  const guardian = options.guardian
    ? {
        kind: 'known' as const,
        stance: options.guardian as 'consented',
        basis: { kind: 'evidence' as const, id: completed(c, 'omer', 'approve-match')?.evidenceId ?? id },
      }
    : { kind: 'unknown' as const };
  const guardianApproval = completed(c, 'omer', 'approve-match'),
    guardianRefusal = completed(c, 'omer', 'withhold-match');
  if (guardianRefusal && (!guardianApproval || guardianRefusal.endedAt > guardianApproval.endedAt))
    return { ok: false, reason: 'The guardian later withheld approval.' };
  if (options.guardian === 'consented' && !completed(c, 'omer', 'approve-match'))
    return { ok: false, reason: 'Guardian approval has no completed receipt.' };
  const marriage: Lifecycle = {
    type: 'marriage',
    partners: [
      { kind: 'actor', id: a.id },
      { kind: 'actor', id: b.id },
    ],
    customId: custom.id,
    guardian,
    kinScopeId: scopeId,
    acceptedProposal: accepted.evidenceId,
    basis: basis(c, id),
  };
  if (!c.run) throw new Error('Marriage Run is missing');
  const stamp = bridgeAt(c, time),
    state = bridgeKinEvidence(c);
  const kin: Lifecycle = {
    type: 'kin-premise',
    premises: [],
    scope: {
      id: scopeId,
      people: [
        { kind: 'entity', id: a.id },
        { kind: 'entity', id: b.id },
      ],
      at: stamp,
      kinRevision: state.kinRevision,
      premiseIds: state.premiseIds,
      degrees: 'source-two-step',
      completeness: 'partial',
      basis: { kind: 'evidence', id: `scope:${id}` },
    },
    basis: basis(c, `scope:${id}`),
  };
  const firstInput = bridgeInput(c, 'lifecycle.received', kin, stamp),
    secondInput = bridgeInput(c, 'lifecycle.received', marriage, stamp),
    sequence = c.next;
  serve(c, stamp, [
    { ...firstInput, id: `lifecycle:${sequence}:0-kin` },
    { ...secondInput, id: `lifecycle:${sequence}:1-marriage` },
  ]);
  return { ok: true };
}
export function conceive(mother: Person, father: Person, _seed: number, time: number): void {
  const c = bridgeContext(mother),
    id = `conception:${mother.id}:${c.next}`;
  submit(
    c,
    {
      type: 'conception',
      mother: { kind: 'actor', id: mother.id },
      father: { kind: 'identified', entity: { kind: 'entity', id: father.id } },
      offspring: { kind: 'entity', id: `unborn:${mother.id}:${c.next}` },
      pregnancyId: `pregnancy:${mother.id}:${c.next}`,
      basis: basis(c, id),
    },
    time,
  );
}
export function deliver(
  mother: Person,
  _child: { id: string; name: string },
  time: number,
): { seed: number; bornAt: number } | null {
  if (!mother.family?.pregnancy || !pregnancyDue(mother, time)) return null;
  // This deprecated seed field is ignored by HF4 construction; HF owns the inherited stream.
  return { seed: 0, bornAt: time };
}
export function birth(_community: Community, mother: Person, father: Person, spec: PersonSpec): Person {
  const c = bridgeContext(mother);
  if (c.staging) throw new Error('Birth must be submitted after the pending action has settled');
  const time = bridgeAt(c, spec.bornAt),
    actualTime = time / MS;
  const pregnancy = mother.family?.pregnancy as unknown as
    | { id: string; offspring: { id: string }; father: { kind: string; entity?: { id: string } } }
    | undefined;
  if (!pregnancy) throw new Error('Birth requires the actual open pregnancy');
  if (pregnancy.father.kind !== 'identified' || pregnancy.father.entity?.id !== father.id)
    throw new Error('Inherited birth requires the actual identified pregnancy father');
  const child = createPerson({ ...spec, id: pregnancy.offspring.id, bornAt: actualTime, now: actualTime }),
    a = authoringOf(child);
  const { body, needs, reserve, retention, affect, promptings, review } = a.state;
  submit(
    c,
    {
      type: 'birth',
      child: {
        kind: 'create',
        newborn: {
          kind: 'two-parent-derived',
          id: child.id,
          identity: { name: child.name },
          sex: {
            kind: 'authored',
            value: spec.sex,
            basis: { kind: 'evidence', id: `birth-sex:${child.id}` },
          },
          parents: [
            { kind: 'actor', id: mother.id },
            { kind: 'actor', id: father.id },
          ],
          context: { body, needs, reserve, retention, affect, promptings, review },
        },
      },
      delivery: {
        kind: 'open-pregnancy',
        mother: { kind: 'actor', id: mother.id },
        pregnancyId: pregnancy.id,
      },
      basis: basis(c, `birth:${child.id}`),
    },
    actualTime,
  );
  if (!c.run) throw new Error('Birth Run is absent');
  bindPerson(child, c.run);
  bindPersonActivityView(child, () => c.active[child.id]?.activity ?? null);
  if (!c.people.some((p) => p.id === child.id)) c.people.push(child);
  const state = bridgeKinEvidence(c),
    kinAt = bridgeAt(c, actualTime),
    kinEvidence = { kind: 'evidence' as const, id: `birth-kin:${child.id}` };
  const premises: Extract<Lifecycle, { type: 'kin-premise' }>['premises'] = [mother, father].flatMap(
    (parent) => [
      {
        id: `birth-kin:${child.id}:${parent.id}:parent`,
        from: { kind: 'entity' as const, id: child.id },
        to: { kind: 'entity' as const, id: parent.id },
        role: 'parent' as const,
        basis: kinEvidence,
      },
      {
        id: `birth-kin:${child.id}:${parent.id}:child`,
        from: { kind: 'entity' as const, id: parent.id },
        to: { kind: 'entity' as const, id: child.id },
        role: 'child' as const,
        basis: kinEvidence,
      },
    ],
  );
  serve(c, kinAt, [
    bridgeInput(
      c,
      'lifecycle.received',
      {
        type: 'kin-premise',
        premises,
        scope: {
          id: `kin:${[mother.id, child.id].sort().join(':')}`,
          people: [
            { kind: 'entity', id: mother.id },
            { kind: 'entity', id: child.id },
          ],
          at: kinAt,
          kinRevision: state.kinRevision + 1,
          premiseIds: [...state.premiseIds, ...premises.map((p) => p.id)],
          degrees: 'source-two-step',
          completeness: 'partial',
          basis: kinEvidence,
        },
        basis: basis(c, kinEvidence.id),
      },
      kinAt,
    ),
  ]);
  return child;
}
export function court(a: Person, b: Person, time: number, options: { quality?: number } = {}): void {
  const c = bridgeContext(a),
    one = completed(c, a.id, 'court', b.id) ?? completed(c, a.id, 'attend-introduction'),
    two = completed(c, b.id, 'court', a.id) ?? completed(c, b.id, 'attend-introduction');
  if (!one || !two) throw new Error('Courtship requires completed voluntary attendance by both adults');
  const overlap =
    Math.min(one.activity.endsAt, two.activity.endsAt) -
    Math.max(one.activity.startedAt, two.activity.startedAt);
  if (overlap <= 0) throw new Error('The adults did not attend at the same time');
  submit(
    c,
    {
      type: 'courtship-meeting',
      partners: [
        { kind: 'actor', id: a.id },
        { kind: 'actor', id: b.id },
      ],
      quality: options.quality ?? 1,
      actionReceipt: one.evidenceId,
      basis: basis(c, `meeting:${one.evidenceId}:${two.evidenceId}`),
    },
    time,
  );
}
export function betroth(a: Person, b: Person, time: number): void {
  const c = bridgeContext(a),
    r = completed(c, a.id, 'accept-proposal', b.id) ?? completed(c, b.id, 'accept-proposal', a.id);
  const decline = completed(c, r?.person ?? b.id, 'decline-proposal', r?.person === a.id ? b.id : a.id);
  if (decline && r && decline.endedAt > r.endedAt)
    throw new Error('A later completed answer declined this proposal');
  if (!r) throw new Error('Engagement requires a completed proposal acceptance');
  const proposal = completed(c, a.id, 'propose', b.id) ?? completed(c, b.id, 'propose', a.id);
  if (!proposal || r.activity.startedAt < proposal.activity.endsAt)
    throw new Error('Engagement requires a completed proposal before acceptance');
  submit(
    c,
    {
      type: 'betrothal',
      partners: [
        { kind: 'actor', id: a.id },
        { kind: 'actor', id: b.id },
      ],
      acceptedProposal: r.evidenceId,
      basis: basis(c, `engagement:${r.evidenceId}`),
    },
    time,
  );
}
export function courtingOffer(
  other: Person,
  options: { id?: string; duration?: number; chaperoned?: boolean; placeId?: string } = {},
): Affordance {
  return {
    id: options.id ?? `court:${other.id}`,
    action: 'court',
    label: `Spend time with ${other.name}`,
    targetId: other.id,
    with: [other.id],
    duration: options.duration ?? 90,
    effort: 0.1,
    advertises: { belonging: 0.15, leisure: 0.1 },
    tags: ['partnering', 'social'],
    ...(options.placeId ? { placeId: options.placeId } : {}),
    ...(options.chaperoned === false
      ? { norms: [{ normId: 'seclusion', relation: 'violates' } as const] }
      : {}),
  };
}
export function proposeOffer(
  _p: Person,
  other: Person,
  options: { id?: string; guardian?: string; lookup?: unknown } = {},
): Affordance {
  return {
    id: options.id ?? `propose:${other.id}`,
    action: 'propose',
    label: `Propose to ${other.name}`,
    targetId: other.id,
    with: [other.id],
    duration: 30,
    effort: 0.05,
    advertises: { belonging: 0.2, meaning: 0.1 },
    tags: ['partnering'],
  };
}
export function proposalOffers(_p: Person, other: Person, _options?: unknown): [Affordance, Affordance] {
  const common = { targetId: other.id, duration: 10, effort: 0, tags: ['partnering'] };
  return [
    {
      ...common,
      id: `accept:${other.id}`,
      action: 'accept-proposal',
      label: `Accept ${other.name}`,
      advertises: { belonging: 0.2, meaning: 0.1 },
    },
    {
      ...common,
      id: `decline:${other.id}`,
      action: 'decline-proposal',
      label: `Decline ${other.name}`,
      advertises: {},
    },
  ];
}
export function familyVoices(
  offers: readonly [Affordance, Affordance],
  approvals: readonly { voiceId: string; approval: number }[],
): Suggestion[] {
  return approvals
    .filter((a) => a.approval !== 0)
    .map(
      (a) =>
        ({
          voiceId: a.voiceId,
          strength: 0,
          familyApproval: {
            kind: 'family-approval',
            voiceId: a.voiceId,
            approval: a.approval,
            acceptOfferId: offers[0].id,
            declineOfferId: offers[1].id,
            evidenceId: `family:${a.voiceId}:${offers[0].id}`,
            adviceId: `family:${a.voiceId}:${offers[0].id}`,
          },
        }) as Suggestion,
    );
}
export function tellDeath(
  listeners: Pick<Community, 'people'>,
  dead: Person,
  time: number,
  _options?: unknown,
): void {
  const c = bridgeContext(dead),
    stamp = bridgeAt(c, time);
  if (dead.body.alive) throw new Error('Death news requires an actual dead person');
  serve(
    c,
    stamp,
    listeners.people
      .filter((p) => p.id !== dead.id)
      .map((p) =>
        bridgeInput(
          c,
          'death.heard',
          {
            person: p.id,
            evidenceId: `death:${dead.id}:${p.id}:${c.next}`,
            deceased: dead.id,
            reporter: 'kahya',
          },
          stamp,
        ),
      ),
  );
}

export function initialKin(people: readonly HF.PersonAuthoring[]): HF.RunSpec['lifecycle'] {
  const kinPremises: HF.RunSpec['lifecycle']['kinPremises'][number][] = [];
  const roles = new Set(['parent', 'child', 'sibling', 'grandparent', 'grandchild', 'spouse']);
  for (const person of people)
    for (const tie of person.state.relationships)
      for (const role of tie.roles)
        if (roles.has(role))
          kinPremises.push({
            id: `opening-kin:${person.id}:${tie.otherId}:${role}`,
            from: { kind: 'entity', id: person.id },
            to: { kind: 'entity', id: tie.otherId },
            role: role as HF.RunSpec['lifecycle']['kinPremises'][number]['role'],
            basis: person.origin.basis,
          });
  const kinScopes: HF.RunSpec['lifecycle']['kinScopes'][number][] = [];
  for (let i = 0; i < people.length; i++)
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i],
        b = people[j];
      if (!a || !b) continue;
      const ids = [a.id, b.id].sort();
      if (ids.join(':') !== 'ali:esma') continue;
      kinScopes.push({
        id: `kin:${ids.join(':')}`,
        people: [
          { kind: 'entity', id: ids[0] ?? a.id },
          { kind: 'entity', id: ids[1] ?? b.id },
        ],
        at: 0,
        kinRevision: 0,
        premiseIds: kinPremises.map((p) => p.id),
        degrees: 'source-two-step',
        completeness: 'partial',
        basis: { kind: 'evidence', id: 'valley-opening-kin' },
      });
    }
  return { kinPremises, kinScopes };
}

export function canMarry(
  a: Person,
  b: Person,
  custom: MarriageCustom = MUSLIM_CUSTOM,
  options: { at?: number; guardian?: unknown; lookup?: unknown } = {},
): { ok: boolean; reason?: string } {
  const c = bridgeContext(a),
    scopeId = `kin:${[a.id, b.id].sort().join(':')}`;
  if (!c.run) return { ok: false, reason: 'No admitted Run' };
  const guardian = options.guardian
    ? {
        kind: 'known' as const,
        stance: options.guardian as 'consented',
        basis: {
          kind: 'evidence' as const,
          id: completed(c, 'omer', 'approve-match')?.evidenceId ?? 'authored-guardian-stance',
        },
      }
    : { kind: 'unknown' as const };
  const result = HF.inspect(c.run, {
    perspective: { kind: 'host' },
    people: [a.id, b.id],
    select: [],
    lifecycle: {
      kind: 'host',
      query: {
        kind: 'can-marry',
        a: a.id,
        b: b.id,
        customId: custom.id,
        at: Math.round((options.at ?? a.now) * MS),
        guardian,
        kinScopeId: scopeId,
      },
    },
  });
  if (!result.ok) return { ok: false, reason: result.error.message };
  const value = result.value.lifecycle;
  if (
    !value ||
    !('value' in value) ||
    !value.value ||
    typeof value.value !== 'object' ||
    !('ok' in value.value)
  )
    return { ok: false, reason: 'Kin eligibility is unknown' };
  return value.value as { ok: boolean; reason?: string };
}
const preparedScopes = new WeakMap<HF.Run, Map<string, string>>();
/** Publish current host kin evidence after settlement, before a pure eligibility query. */
export function prepareKinScope(a: Person, b: Person, time = Math.max(a.now, b.now)): void {
  const c = bridgeContext(a);
  if (c.staging) throw new Error('Kin preparation must follow accepted action settlement');
  if (!c.run) throw new Error('Kin preparation requires an admitted Run');
  const scopeId = `kin:${[a.id, b.id].sort().join(':')}`;
  const prepared = preparedScopes.get(c.run) ?? new Map<string, string>();
  if (prepared.get(scopeId) === frameKey(c, Math.max(a.now, b.now)) && time <= Math.max(a.now, b.now)) return;
  const state = bridgeKinEvidence(c),
    stamp = bridgeAt(c, time),
    id = `kin-current:${a.id}:${b.id}:${c.next}`;
  serve(c, stamp, [
    bridgeInput(
      c,
      'lifecycle.received',
      {
        type: 'kin-premise',
        premises: [],
        scope: {
          id: `kin:${[a.id, b.id].sort().join(':')}`,
          people: [
            { kind: 'entity', id: a.id },
            { kind: 'entity', id: b.id },
          ],
          at: stamp,
          kinRevision: state.kinRevision,
          premiseIds: state.premiseIds,
          degrees: 'source-two-step',
          completeness: 'partial',
          basis: { kind: 'evidence', id },
        },
        basis: basis(c, id),
      },
      stamp,
    ),
  ]);
  // Cache only the accepted frame. Any input counter, clock or world revision change invalidates it.
  prepared.set(scopeId, frameKey(c, Math.max(a.now, b.now)));
  preparedScopes.set(c.run, prepared);
}
