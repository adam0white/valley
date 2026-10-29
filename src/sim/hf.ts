/** Valley's HF4 host boundary. This module translates minutes once. HF owns all actor changes. */
import * as HF from '@adam0white/human-framework';
import { initialKin, MUSLIM_CUSTOM_DATA } from './hf-lifecycle.ts';
import type {
  Activity,
  Affordance,
  DecisionRecord,
  Outcome,
  Percept,
  Person,
  Suggestion,
} from './hf-person.ts';
import {
  authoringOf,
  bindPerson,
  bindPersonActivityView,
  createPerson,
  frozenPerson,
  invalidatePersonReads,
  personFromFrozenRef,
  personRun,
} from './hf-person.ts';
import { TRUSTED_NORMS } from './passport.ts';

export * from './hf-person.ts';
export const FRAMEWORK_VERSION = '4.8.0';
export const { exportRun, restoreRun, inspect, preview } = HF;
export const MINUTES_PER_YEAR = 365 * 1440;
export const MS = 60_000;
export function need<T>(result: HF.Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code} ${result.error.path}: ${result.error.message}`);
  return result.value;
}
export interface World {
  now(): number;
  affordancesFor(p: Person): Affordance[];
  perceptsFor(p: Person, since: number, until: number): Percept[];
  scarcityFor(p: Person): number;
  beginOptions(p: Person, offer: Affordance, record: DecisionRecord): unknown;
  decisionObserved?(p: Person, offer: Affordance, record: DecisionRecord): void;
  boundaryAccepted?(): void;
  locationAfter?(p: Person, activity: Activity): string | undefined;
  allowStart?(p: Person, offer: Affordance): boolean;
  resolve(p: Person, activity: Activity, reason: 'ended' | 'interrupted'): Outcome;
  colocated?(a: Person, b: Person): boolean;
  stage?(): { world: World; publish(): void };
}
export interface CommunityState {
  fidelity?: HF.Fidelity;
  places?: Record<string, string>;
  seed?: number;
  glimpses?: Array<{ observer: string; target: string; at: number; clarity: number }>;
  completed?: Array<{ person: string; activity: Activity; evidenceId: string; endedAt: number }>;
  archive?: HF.DeepReadonly<HF.RunArchive>;
  ingress: number;
  next: number;
  offers: Record<string, Affordance[]>;
  revisions: Record<string, number>;
  scarcity?: Record<string, number>;
  suggestions?: Record<string, string>;
  active: Record<string, { id: string; activity: Activity }>;
  interrupts: Record<string, { at: number; reason: string }>;
}
export interface Community extends CommunityState {
  people: Person[];
  run?: HF.Run;
  world?: World;
  revision?: number;
  staging?: Community;
  deferred?: Array<{ kind: keyof HF.Payloads; payload: HF.Payloads[keyof HF.Payloads] }>;
}
const communities = new WeakMap<HF.Run, Community>();
const eventCache = new WeakMap<HF.Run, HF.DeepReadonly<HF.StepResult>['events']>();
type KinEvidence = { readonly kinRevision: number; readonly premiseIds: readonly string[] };
const kinEvidenceCache = new WeakMap<HF.Run, KinEvidence>();
/** Cache only exported public lifecycle metadata. Accepted lifecycle changes invalidate it. */
export function bridgeKinEvidence(c: Community): KinEvidence {
  const run = communityRun(c);
  let evidence = kinEvidenceCache.get(run);
  if (!evidence) {
    const state = HF.exportRun(run).current.lifecycle;
    evidence = Object.freeze({
      kinRevision: state.kinRevision,
      premiseIds: Object.freeze(state.kinPremises.map((p) => p.id)),
    });
    kinEvidenceCache.set(run, evidence);
  }
  return evidence;
}

const actionIds = [
  'relieve',
  'cook',
  'store-check',
  'build',
  'flock-care',
  'gather-grain',
  'observe-route',
  'draw-water',
  'digging-advice',
  'household-work',
  'sleep',
  'rest',
  'eat',
  'drink',
  'tend',
  'chat',
  'pray',
  'christian-prayer',
  'reap',
  'sow',
  'reap-agha',
  'build-mill',
  'bring-share',
  'glean-agha',
  'ask-kahya',
  'leave',
  'walk',
  'advise-digging',
  'survey',
  'gather',
  'waterwork',
  'cook',
  'care',
  'wait',
  'terms-walk-out',
  'terms-walk-home',
  'terms-give-food',
  'terms-help-assent',
  'terms-help-decline',
  'terms-help',
  'terms-speech',
  'answer-dialogue',
  'hear-dialogue',
  'give',
  'seize',
  'ease',
  'decline-visit',
  'turn-away',
  'miss-wedding',
  'leave-waiting',
  'court',
  'propose',
  'marry',
  'attend-introduction',
  'supervise-introduction',
  'approve-match',
  'accept-proposal',
  'decline-proposal',
  'propose-marriage',
  'witness-marriage',
];
function spec(people: Person[], seed: number): HF.RunSpec {
  const drafts = people.map(authoringOf);
  const actions = new Set([
    ...actionIds,
    'approve-match',
    'ask-kahya',
    'bring-share',
    'build-mill',
    'chat',
    'christian-prayer',
    'drink',
    'early-sack',
    'neighbour-loan',
    'repay-neighbour',
    'levy-service',
    'eat',
    'glean-agha',
    'help',
    'leave',
    'play',
    'pray',
    'reap',
    'reap-agha',
    'repair-pass',
    'rest',
    'sleep',
    'sow',
    'supervise-introduction',
    'tend',
    'terms-carry-food',
    'terms-walk-home',
    'valley-hearth-talk',
    'visit',
    'walk',
    'withhold-match',
    'witness-marriage',
  ]);
  for (const p of drafts) {
    for (const ref of p.portable?.mapping.references ?? [])
      if (ref.kind === 'action') actions.add(ref.target);
    for (const c of p.state.agenda.commitments) for (const a of c.actions ?? []) actions.add(a);
    for (const h of p.state.habits) actions.add(h.action);
    for (const g of p.state.agenda.goals) for (const a of g.advancedBy) actions.add(a.action);
  }
  return {
    id: 'valley',
    seed,
    start: 0,
    host: { id: 'valley', edition: 'valley-hf48', schema: 'valley-run-1' },
    definitions: {
      actions: [...actions].sort().map((id) => ({
        id,
        label: id,
        demands: { effort: 0, focus: 0, mode: 'awake', requires: {} },
        tags: [],
        norms: [],
      })),
      norms: TRUSTED_NORMS,
      marriageCustoms: [MUSLIM_CUSTOM_DATA],
      skills: [...new Set(drafts.flatMap((p) => p.state.skills.map((s) => s.id)))]
        .sort()
        .map((id) => ({ id, label: id, domain: 'general' })),
      skillTransfers: [],
      methods: [],
      routines: [],
      sources: [
        { type: 'host', id: 'valley' },
        { type: 'voice', id: 'kahya' },
        ...[
          ...new Set(
            drafts
              .flatMap((p) => [
                ...(p.portable?.person.version === 2
                  ? Object.keys(p.portable.person.retained.memory.sourceTrust)
                  : []),
                ...(p.portable?.mapping.references.filter((r) => r.kind === 'source').map((r) => r.target) ??
                  []),
              ])
              .filter((id) => id !== 'kahya' && id !== 'valley' && !people.some((p) => p.id === id)),
          ),
        ].map((id) => ({ type: 'voice' as const, id })),
        ...[
          ...new Set([
            ...people.map((p) => p.id),
            ...drafts.flatMap((p) => p.state.relationships.map((r) => r.otherId)),
          ]),
        ].map((id) => ({ type: 'person' as const, id })),
      ],
      lexicon: {
        names: Object.fromEntries(people.map((p) => [p.id, p.name])),
        roles: { kahya: 'the steward' },
        prefer: 'name',
        actions: {},
      },
      calendar: {
        id: 'valley',
        epoch: { id: 'valley-epoch', simulationAt: 0, dayIndex: 0, msOfDay: 0 },
        dayMs: 86400000,
        days: Array.from({ length: 1100 }, (_, dayIndex) => ({
          dayIndex,
          start: dayIndex * 86400000,
          windows: [],
        })),
      },
    },
    lifecycle: initialKin(drafts),
    world: {
      revision: 0,
      facts: [
        ...new Set(
          drafts.flatMap(
            (p) =>
              p.portable?.mapping.references.filter((r) => r.kind === 'entity').map((r) => r.target) ?? [],
          ),
        ),
      ]
        .sort()
        .map((id) => ({
          id: `portable-entity:${id}`,
          subject: id,
          predicate: 'known-portable-reference',
          value: true,
          at: 0,
          provenance: { source: 'valley', evidenceId: `portable-reference:${id}` },
        })),
      hostState: { schema: 'valley-run-1', activeCount: 0 },
    },
  };
}
function communityRun(c: Community): HF.Run {
  if (!c.run) throw new Error('No admitted community Run');
  return c.run;
}
export function createCommunity(people: Person[], state?: CommunityState): Community {
  const c: Community = {
    ...(state?.fidelity ? { fidelity: state.fidelity } : {}),
    places: { ...state?.places },
    glimpses: structuredClone(state?.glimpses ?? []),
    scarcity: { ...state?.scarcity },
    suggestions: { ...state?.suggestions },
    seed: state?.seed ?? 1,
    completed: structuredClone(state?.completed ?? []),
    people,
    interrupts: { ...state?.interrupts },
    ingress: state?.ingress ?? -1,
    next: state?.next ?? 1,
    offers: structuredClone(state?.offers ?? {}),
    revisions: { ...state?.revisions },
    active: structuredClone(state?.active ?? {}),
    ...(state?.archive ? { archive: state.archive } : {}),
  };
  if (!people.length) return c;
  const run = state?.archive
    ? need(HF.restoreRun(state.archive))
    : need(HF.createRun(spec(people, c.seed ?? 1)));
  if (!state?.archive)
    for (const p of people) {
      const result = HF.createPerson(run, authoringOf(p));
      if (!result.ok)
        throw new Error(`${p.id}: ${result.error.code} ${result.error.path}: ${result.error.message}`);
    }
  c.run = run;
  c.revision = state?.archive?.current.world.revision ?? 0;
  communities.set(run, c);
  for (const p of people) {
    bindPerson(p, run);
    bindPersonActivityView(p, () => (c.staging ?? c).active[p.id]?.activity ?? null);
  }
  return c;
}
export function addPerson(c: Community, p: Person): void {
  if (c.people.some((x) => x.id === p.id)) return;
  if (!c.run) throw new Error('Community has not been admitted');
  need(HF.createPerson(c.run, authoringOf(p)));
  c.people.push(p);
  bindPerson(p, c.run);
  bindPersonActivityView(p, () => (c.staging ?? c).active[p.id]?.activity ?? null);
}
export function archiveCommunity(c: Community): CommunityState {
  return {
    ...(c.fidelity ? { fidelity: c.fidelity } : {}),
    places: { ...c.places },
    glimpses: structuredClone(c.glimpses ?? []),
    scarcity: { ...c.scarcity },
    suggestions: { ...c.suggestions },
    seed: c.seed,
    completed: structuredClone(c.completed),
    interrupts: { ...c.interrupts },
    archive: c.run ? HF.exportRun(c.run) : undefined,
    ingress: c.ingress,
    next: c.next,
    offers: structuredClone(c.offers),
    revisions: { ...c.revisions },
    active: structuredClone(c.active),
  };
}
export function communityForPerson(p: Person): Community | undefined {
  const r = personRun(p);
  return r ? communities.get(r) : undefined;
}
function context(p: Person): Community {
  const r = personRun(p);
  const c = r && communities.get(r);
  if (!c?.run) throw new Error('Person has no admitted Valley run');
  return c;
}
function at(c: Community, minute?: number): number {
  return Math.max(Math.round((minute ?? c.world?.now() ?? 0) * MS), c.ingress + 1);
}
function input<K extends keyof HF.Payloads>(
  c: Community,
  kind: K,
  payload: HF.Payloads[K],
  time: number,
): HF.Input {
  return {
    id: `valley:${String(c.next++).padStart(12, '0')}`,
    at: time,
    source: { type: 'host', id: 'valley' },
    kind,
    payload,
  } as HF.Input;
}
function publicOffer(p: Person, a: Affordance): HF.Offer {
  if (a.forecastAt && (a.forecastAt.comfortAt === undefined || a.forecastAt.spentAt === undefined))
    throw new Error('A forecast must author both comfortAt and spentAt.');
  return {
    id: a.id,
    actionId: a.action,
    label: a.label,
    person: p.id,
    durationMs: Math.round(a.duration * MS),
    ...(a.targetId ? { target: a.targetId } : {}),
    ...(a.placeId ? { place: a.placeId } : {}),
    participants: (a as Affordance & { participants?: string[] }).participants ?? a.with ?? [],
    alongside: a.alongside ?? [],
    demands: {
      effort: a.effort ?? 0,
      focus: a.focus ?? 0,
      mode: a.mode ?? 'awake',
      requires: a.requires ?? {},
      ...(a.skill ? { skill: { ...a.skill, domain: a.skill.domain ?? 'general' } } : {}),
    },
    tags: a.tags ?? [],
    norms: a.norms ?? [],
    ...(a.methodContext ? { methodContext: a.methodContext } : {}),
    ...(a.jointId ? { jointId: a.jointId } : {}),
    expected: {
      needs: a.advertises ?? {},
      ...(a.material === undefined ? {} : { material: a.material }),
      ...(a.risk ? { risk: a.risk } : {}),
      ...(a.action === 'relieve' ? { voidsBladder: true } : {}),
      followedBy: (a.followedBy ?? []).map(({ duration, ...rest }) => ({
        ...rest,
        durationMs: Math.round(duration * MS),
      })),
      ...(a.forecastAt
        ? {
            forecastAt: {
              comfortAt: a.forecastAt.comfortAt as number,
              spentAt: a.forecastAt.spentAt as number,
            },
          }
        : {}),
      provenance: ['authored:valley-world'],
    },
    fulfills: a.fulfills ?? [],
    advances: [
      ...new Set([
        ...(a.advances ?? []),
        ...p.agenda.goals
          .filter((g) => g.status === 'active' && g.advancedBy.some((x) => x.action === a.action))
          .map((g) => g.id),
      ]),
    ],
    diminishes: [],
  };
}
function publicPercept(c: Community, p: Percept): HF.PerceptData {
  const id = `percept:${c.next++}`;
  return {
    id,
    occurredAt: Math.round(p.at * MS),
    channel: p.channel,
    kind: p.kind,
    ...(p.actorId ? { actorId: p.actorId } : {}),
    ...(p.targetId ? { targetId: p.targetId } : {}),
    ...(p.placeId ? { placeId: p.placeId } : {}),
    valence: p.valence ?? 0,
    salience: p.salience,
    summary: p.summary,
    ...(p.near === undefined ? {} : { near: p.near }),
    claims: p.claims ?? [],
    norms: p.norms ?? [],
    ...(p.threat ? { threat: p.threat } : {}),
    advice: (p.advice ?? []).map((advice, index) => ({ ...advice, adviceId: `${id}:advice:${index}` })),
    ...(p.demonstrates
      ? {
          demonstrates: {
            skill: p.demonstrates.skill,
            level: p.demonstrates.level,
            durationMs: Math.round(p.demonstrates.minutes * MS),
            domain: p.demonstrates.domain ?? 'general',
          },
        }
      : {}),
    consequences: (p.consequences ?? []).map(
      ({ successor, availableFrom, availableUntil, expiresAt, ...rest }) => {
        const { duration, ...action } = successor;
        return {
          ...rest,
          successor: { ...action, durationMs: Math.round(duration * MS) },
          availableFrom: Math.round(availableFrom * MS),
          availableUntil: Math.round(availableUntil * MS),
          expiresAt: Math.round(expiresAt * MS),
        };
      },
    ),
    withdrawConsequences: p.withdrawConsequences ?? [],
    witnesses: [],
    reports: [],
    provenance: ['valley-world-observation'],
  };
}
function decision(d: unknown): DecisionRecord {
  const record = d as DecisionRecord;
  const convert = (r: DecisionRecord['suggestion']) =>
    r ? { ...r, says: r.says ?? record.intention } : undefined;
  return {
    ...record,
    at: record.at / MS,
    narration: record.intention,
    suggestion: convert(record.suggestion),
    suggestions: record.suggestions?.map((r) => ({ ...r, says: r.says ?? record.intention })),
  };
}
function recordFor(c: Community, p: Person): DecisionRecord {
  const e = eventCache.get(communityRun(c))?.findLast((e) => e.person === p.id && e.data.kind === 'decision');
  if (e?.data.kind !== 'decision') throw new Error('HF supplied no decision record');
  return decision(e.data.decision);
}
function receipt(c: Community, r: HF.DeepReadonly<HF.HostRequest>): HF.Input {
  const base = { requestId: r.id, requestHash: r.requestHash, worldRevision: c.revision ?? 0 };
  if (r.kind === 'communication') {
    const speaker = c.people.find((p) => p.id === r.speaker);
    const received = r.recipients.flatMap((id) => {
      const listener = c.people.find((p) => p.id === id);
      return speaker && listener && c.world?.colocated?.(speaker, listener)
        ? [
            {
              recipient: id,
              evidenceId: `transport:${r.id}:${id}`,
              attention:
                !listener.body.asleep &&
                listener.activity &&
                ['chat', 'valley-hearth-talk', 'terms-help-assent', 'terms-help-decline'].includes(
                  listener.activity.action,
                )
                  ? 1
                  : 0,
              itemIds: r.items.map((i) => i.id),
            },
          ]
        : [];
    });
    return input(
      c,
      'communication.resolved',
      { ...base, speaker: r.speaker, emittedItemIds: r.items.map((i) => i.id), received },
      r.boundaryAt,
    );
  }
  const p = c.people.find((p) => p.id === r.person);
  if (!p) throw new Error('Action actor missing');
  const action = { ...base, person: r.person, activityId: r.activityId, stage: r.stage };
  if (r.stage === 'start') {
    const offered = c.offers[p.id]?.find((o) => o.id === r.offerId);
    const available =
      c.world?.affordancesFor(p).some((a) => a.id === r.offerId && a.action === offered?.action) ?? true;
    const offer = available ? offered : undefined;
    if (!offer || c.world?.allowStart?.(p, offer) === false)
      return input(
        c,
        'action.resolved',
        { ...action, disposition: 'rejected', observations: [] },
        r.boundaryAt,
      );
    const d = recordFor(c, p);
    const activity: Activity = {
      affordanceId: offer.id,
      action: offer.action,
      affordance: structuredClone(offer),
      ...(offer.targetId ? { targetId: offer.targetId } : {}),
      needsAtStart: {},
      startedAt: r.boundaryAt / MS,
      endsAt: r.boundaryAt / MS + offer.duration,
      effort: offer.effort ?? 0,
      focus: offer.focus ?? 0,
      mode: offer.mode ?? 'awake',
      decisionId: d.id,
      intention: d.intention,
      suggestion: d.suggestion,
      protest: d.suggestion?.verdict === 'complied',
      reviewAt: r.boundaryAt / MS + offer.duration,
    };
    c.active[p.id] = { id: r.activityId, activity };
    if (offer.placeId) {
      c.places ??= {};
      c.places[p.id] = offer.placeId;
    }
    c.world?.beginOptions(p, offer, d);
    return input(
      c,
      'action.resolved',
      { ...action, disposition: 'accepted', observations: [], worldChange: changed(c) },
      r.boundaryAt,
    );
  }
  const a = c.active[p.id];
  if (!a || a.id !== r.activityId) throw new Error('Host lost accepted activity');
  const pendingCompletion =
    r.stage === 'finish'
      ? {
          person: p.id,
          activity: structuredClone(a.activity),
          evidenceId: `outcome:${r.id}`,
          endedAt: r.boundaryAt / MS,
        }
      : undefined;
  if (pendingCompletion) {
    c.completed ??= [];
    c.completed.push(pendingCompletion);
  }
  const out = c.world?.resolve(p, a.activity, r.stage === 'interrupt' ? 'interrupted' : 'ended') ?? {
    at: r.boundaryAt / MS,
    action: a.activity.action,
    affordanceId: a.activity.affordanceId,
    status: r.stage === 'interrupt' ? 'interrupted' : 'completed',
  };
  if (out.status === 'completed' && a.activity.action === 'chat') {
    const listener = c.people.find(
      (other) => other.id !== p.id && other.activity?.action === 'chat' && c.world?.colocated?.(p, other),
    );
    if (listener) {
      const live = context(p);
      bridgeDefer(
        live,
        'conversation.requested',
        {
          speaker: p.id,
          listener: listener.id,
          topicIds: [],
          maxClaims: 2,
          temptations: [],
          loyalWarning: false,
        },
        r.boundaryAt / MS,
      );
    }
  }
  const place = c.world?.locationAfter?.(p, a.activity);
  if (place) {
    c.places ??= {};
    c.places[p.id] = place;
  }
  delete c.active[p.id];
  if (pendingCompletion && out.status !== 'completed') c.completed?.pop();
  if ((c.completed?.length ?? 0) > 256) c.completed?.shift();
  const needs = out.needs ?? {};
  const { food, water, relief: _relief, rest: _rest, sleep: _sleep, ...psychological } = needs;
  const actual: HF.ActualConsequences = {
    exposures: (out.exposures ?? []).map((exposure, index) => ({
      agent: exposure.kind,
      amount: exposure.amount ?? 1,
      exposureId: `outcome:${r.id}:exposure:${index}`,
    })),
    ...(out.injury ? { injury: out.injury } : {}),
    ...(out.illness ? { illness: out.illness } : {}),
    ...(out.practice ? { practice: out.practice } : {}),
    observedProgress: [],
    ...(out.status === 'completed' && a.activity.action === 'relieve' ? { voidedBladder: true } : {}),
    psychological,
    ...(out.material === undefined ? {} : { material: out.material }),
    ...(food !== undefined || water !== undefined
      ? { consumed: { ...(food === undefined ? {} : { food }), ...(water === undefined ? {} : { water }) } }
      : {}),
  };
  return input(
    c,
    'action.resolved',
    {
      ...action,
      disposition: out.status,
      observations: out.percepts?.length
        ? [{ person: p.id, percepts: out.percepts.map((percept) => publicPercept(c, percept)) }]
        : [],
      worldChange: changed(c),
      outcome: {
        activityId: r.activityId,
        offerId: a.activity.affordanceId,
        actionId: a.activity.action,
        ...((out.targetId ?? a.activity.targetId) ? { target: out.targetId ?? a.activity.targetId } : {}),
        start: Math.round(a.activity.startedAt * MS),
        end: r.boundaryAt,
        status: out.status,
        evidenceId: `outcome:${r.id}`,
        actual,
        summary: out.summary ?? `${p.name} ${out.status} ${a.activity.affordance.label}.`,
        fulfills: out.status === 'completed' ? (out.fulfills ?? a.activity.affordance.fulfills ?? []) : [],
        advances:
          out.status === 'completed'
            ? (out.advances ?? [
                ...new Set([
                  ...(a.activity.affordance.advances ?? []),
                  ...p.agenda.goals
                    .filter(
                      (g) =>
                        g.status === 'active' && g.advancedBy.some((x) => x.action === a.activity.action),
                    )
                    .map((g) => g.id),
                ]),
              ])
            : [],
        ...(out.quality === undefined ? {} : { quality: out.quality }),
      },
    },
    r.boundaryAt,
  );
}
function changed(c: Community): HF.WorldChange {
  const expectedRevision = c.revision ?? 0;
  c.revision = expectedRevision + 1;
  return {
    expectedRevision,
    revision: c.revision,
    put: [],
    remove: [],
    hostState: { schema: 'valley-run-1', activeCount: Object.keys(c.active).length },
  };
}
export function serve(c: Community, until: number, inputs: HF.Input[] = []): HF.DeepReadonly<HF.StepResult> {
  if (!c.run) throw new Error('No run');
  if (c.staging) throw new Error('Cannot recursively advance a pending HF boundary');
  let batch = inputs;
  let batchUntil = until;
  let candidate: Community | undefined;
  let publish: (() => void) | undefined;
  const events: HF.DeepReadonly<HF.StepResult>['events'][number][] = [];
  for (let n = 0; n < 20000; n++) {
    let result: HF.DeepReadonly<HF.StepResult>;
    try {
      result = need(
        HF.step(c.run, { until: batchUntil, inputs: batch, ...(c.fidelity ? { fidelity: c.fidelity } : {}) }),
      );
      invalidatePersonReads(c.run);
      if (
        batch.some(
          (input) =>
            input.kind === 'lifecycle.received' &&
            !(input.payload.type === 'kin-premise' && input.payload.premises.length === 0),
        ) ||
        result.events.some(
          (event) =>
            (event.data.kind === 'lifecycle' &&
              !(event.data.receipt.type === 'kin-premise' && event.data.receipt.premises.length === 0)) ||
            (event.data.kind === 'body-change' && event.data.change.kind === 'died'),
        )
      )
        kinEvidenceCache.delete(c.run);
    } catch (error) {
      c.staging = undefined;
      throw error;
    }
    if (candidate) {
      c.active = candidate.active;
      c.places = candidate.places;
      c.completed = candidate.completed;
      c.deferred = candidate.deferred;
      c.next = candidate.next;
      c.revision = candidate.revision;
      publish?.();
      c.staging = undefined;
      candidate = undefined;
      publish = undefined;
    }
    c.world?.boundaryAccepted?.();
    events.push(...result.events);
    eventCache.set(c.run, events);
    for (const event of result.events)
      if (event.data.kind === 'decision' && event.data.decision.review && event.person) {
        const d = event.data.decision;
        const p = c.people.find((p) => p.id === event.person);
        const offer = c.offers[event.person]?.find((a) => a.id === d.chosenAffordanceId);
        if (p && offer) c.world?.decisionObserved?.(p, offer, decision(d));
      }
    c.ingress = Math.max(c.ingress, result.at);
    if (result.boundary.type === 'until') {
      if (c.deferred?.length) {
        const queued = c.deferred;
        c.deferred = [];
        const stamp = c.ingress + 1;
        const extra = serve(
          c,
          stamp,
          queued.map((q) =>
            input(
              c,
              q.kind,
              q.kind === 'lifecycle.received'
                ? ({
                    ...q.payload,
                    basis: {
                      ...(q.payload as HF.Payloads['lifecycle.received']).basis,
                      worldRevision: c.revision ?? 0,
                    },
                  } as HF.Payloads['lifecycle.received'])
                : q.payload,
              stamp,
            ),
          ),
        );
        events.push(...extra.events);
        if (extra.at < until) {
          batch = [];
          batchUntil = until;
          continue;
        }
        return { ...extra, events };
      }
      if (result.at < until) {
        batch = [];
        batchUntil = until;
        continue;
      }
      return { ...result, events };
    }
    batchUntil = result.at;
    const stagedWorld = c.world?.stage?.();
    candidate = {
      ...c,
      active: structuredClone(c.active),
      places: { ...c.places },
      completed: structuredClone(c.completed),
      deferred: structuredClone(c.deferred ?? []),
      world: stagedWorld?.world ?? c.world,
      revision: c.revision ?? 0,
    };
    publish = stagedWorld?.publish;
    c.staging = candidate;
    const staged = candidate;
    try {
      batch = [...result.boundary.requests]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((r) => receipt(staged, r));
    } catch (error) {
      c.staging = undefined;
      throw error;
    }
  }
  throw new Error('Valley host boundary did not progress');
}
export function stepCommunity(
  c: Community,
  w: World,
  to: number,
  options: { suggestions?: Record<string, Suggestion | readonly Suggestion[]> } = {},
): SimEvent[] {
  c.world = w;
  const time = at(c, w.now());
  const inputs: HF.Input[] = [];
  for (const p of c.people) {
    const percepts = w.perceptsFor(p, p.now, w.now()).map((pc) => publicPercept(c, pc));
    if (percepts.length)
      inputs.push(
        input(
          c,
          'observation.received',
          { person: p.id, evidenceId: `observations:${c.next}`, percepts },
          time,
        ),
      );
    const scarcity = w.scarcityFor(p);
    if (c.scarcity?.[p.id] !== scarcity) {
      c.scarcity ??= {};
      c.scarcity[p.id] = scarcity;
      inputs.push(
        input(
          c,
          'context.received',
          { person: p.id, evidenceId: `scarcity:${c.next}`, context: { kind: 'scarcity', value: scarcity } },
          time,
        ),
      );
    }
    const offers = w.affordancesFor(p);

    const changedOffers = JSON.stringify(c.offers[p.id]) !== JSON.stringify(offers);
    const revision = (c.revisions[p.id] ?? 0) + (changedOffers ? 1 : 0);
    if (changedOffers) {
      c.offers[p.id] = offers;
      c.revisions[p.id] = revision;
      inputs.push(
        input(
          c,
          'offers.received',
          { person: p.id, revision, offers: offers.map((a) => publicOffer(p, a)) },
          time,
        ),
      );
    }
    const suggestions = options.suggestions?.[p.id];
    for (const sg of suggestions ? (Array.isArray(suggestions) ? suggestions : [suggestions]) : []) {
      inputs.push(
        input(
          c,
          'suggestion.received',
          {
            person: p.id,
            received: (sg as Suggestion & { familyApproval?: HF.Payloads['suggestion.received']['received'] })
              .familyApproval ?? {
              kind: 'ordinary',
              suggestion: {
                ...sg,
                since: Math.round((sg.since ?? w.now()) * MS),
                adviceId: `advice:${p.id}:${sg.voiceId}:${sg.since ?? w.now()}`,
              },
            },
          },
          time,
        ),
      );
    }
    if (!p.activity && p.body.alive && offers.length)
      inputs.push(
        input(
          c,
          'decision.requested',
          {
            person: p.id,
            reason: 'Valley day and available work',
            treatment: 'ordinary',
            offerRevision: revision,
          },
          time,
        ),
      );
  }
  const result = serve(c, Math.max(time, Math.round(to * MS)), inputs);
  const due = c.glimpses?.filter((g) => g.at <= to) ?? [];
  c.glimpses = c.glimpses?.filter((g) => g.at > to) ?? [];
  for (const glimpse of due) {
    const observer = c.people.find((p) => p.id === glimpse.observer),
      target = c.people.find((p) => p.id === glimpse.target);
    if (observer && target) glimpsePerson(observer, target, observer.now, glimpse.clarity);
  }
  return result.events.flatMap((e) =>
    e.data.kind === 'action-settled' && e.data.disposition === 'completed'
      ? [{ kind: 'finish', at: e.at / MS, personId: e.person ?? '' } as SimEvent]
      : e.data.kind === 'lifecycle' && e.data.receipt.type === 'death'
        ? [{ kind: 'died', at: e.at / MS, personId: e.data.receipt.person.id } as SimEvent]
        : e.data.kind === 'body-change' && e.data.change.kind === 'died'
          ? [{ kind: 'died', at: e.at / MS, personId: e.person ?? '' } as SimEvent]
          : [],
  );
}
/** Withdraw the host's offers through the same accepted public boundary before a resident leaves. */
export function withdrawOffers(c: Community, person: Person): void {
  const revision = (c.revisions[person.id] ?? 0) + 1;
  const stamp = at(c, person.now);
  serve(c, stamp, [input(c, 'offers.received', { person: person.id, revision, offers: [] }, stamp)]);
  c.offers[person.id] = [];
  c.revisions[person.id] = revision;
}
export function decide(
  p: Person,
  offers: Affordance[],
  options?: { suggestion?: Suggestion },
): DecisionRecord {
  const c = context(p),
    time = at(c, p.now),
    revision = (c.revisions[p.id] ?? 0) + 1;
  c.revisions[p.id] = revision;
  c.offers[p.id] = structuredClone(offers);
  const inputs = [
    input(
      c,
      'offers.received',
      { person: p.id, revision, offers: offers.map((a) => publicOffer(p, a)) },
      time,
    ),
  ];
  if (options?.suggestion)
    inputs.push(
      input(
        c,
        'suggestion.received',
        {
          person: p.id,
          received: {
            kind: 'ordinary',
            suggestion: { ...options.suggestion, adviceId: `advice:${c.next}`, since: time },
          },
        },
        time,
      ),
    );
  inputs.push(
    input(
      c,
      'decision.requested',
      { person: p.id, reason: 'A concrete Valley action', treatment: 'ordinary', offerRevision: revision },
      time,
    ),
  );
  serve(c, time, inputs);
  return recordFor(c, p);
}
export function begin(p: Person, offer: Affordance, _record: DecisionRecord): Activity | null {
  const a = context(p).active[p.id]?.activity;
  return a?.affordanceId === offer.id ? a : null;
}
export function finish(p: Person, out: Outcome): void {
  const c = context(p),
    a = c.active[p.id];
  if (!a) return;
  if (out.status !== 'interrupted')
    throw new Error('HF action completion must settle at its real host boundary');
  const time = at(c, p.now);
  serve(c, time, [
    input(
      c,
      'activity.interrupted',
      { person: p.id, activityId: a.id, reason: 'The steward changed the actual plan' },
      time,
    ),
  ]);
}
export function tick(p: Person, to: number): void {
  const c = context(p);
  if (to * MS > c.ingress) serve(c, to * MS);
}
export function snapshot(p: Person): Person {
  return frozenPerson(p);
}
export function restore(p: Person): Person {
  const ref = p as Person & { sourceArchive?: HF.RunArchive };
  return ref.sourceArchive
    ? personFromFrozenRef({ ...ref, sourceArchive: ref.sourceArchive })
    : createPerson({ id: p.id, name: p.name, seed: 1, bornAt: p.life.bornAt, sex: p.life.sex });
}
export function perceive(p: Person, percepts: readonly Percept[]): Percept[] {
  const c = context(p),
    time = at(c, p.now),
    mapped = percepts.map((pc) => publicPercept(c, pc)),
    id = `observation:${c.next}`;
  const result = serve(c, time, [
    input(c, 'observation.received', { person: p.id, evidenceId: id, percepts: mapped }, time),
  ]);
  const heard = new Set(
    result.events.flatMap((e) =>
      e.data.kind === 'observation-attended' && e.data.attention > 0 ? [e.data.perceptId] : [],
    ),
  );
  return percepts.filter((_, i) => heard.has(mapped[i]?.id ?? ''));
}
export function recall(
  p: Person,
  options: { actorId?: string; limit?: number } = {},
): import('./hf-person.ts').Episode[] {
  return p.memory.episodes
    .filter((e) => !options.actorId || e.actorId === options.actorId)
    .slice(-(options.limit ?? 6));
}
export function voiceAct(p: Person, voice: string, action: string, felt: number): void {
  const c = context(p),
    time = at(c, p.now);
  serve(c, time, [
    input(
      c,
      'voice.evidence-received',
      {
        person: p.id,
        evidenceId: `valley:${String(c.next).padStart(12, '0')}`,
        voiceId: voice,
        evidence: {
          id: `valley:${String(c.next).padStart(12, '0')}`,
          occurredAt: time,
          kind: 'act',
          action,
          felt,
        },
      },
      time,
    ),
  ]);
}
export function promise(p: Person, definition: Record<string, unknown>): import('./hf-person.ts').Commitment {
  const c = personRun(p) ? context(p) : undefined,
    id = `commitment:${p.id}:${c?.next ?? authoringOf(p).state.agenda.commitments.length}`;
  const { recurEvery: _legacyRecurrence, ...authoredCommitment } = definition;
  const commitment = {
    ...authoredCommitment,
    id,
    from: Math.round(Number(definition.from) * MS),
    until: Math.round(Number(definition.until) * MS),
    ...(definition.recurEvery ? { recurEveryMs: Math.round(Number(definition.recurEvery) * MS) } : {}),
  };
  if (c) {
    const time = at(c, p.now);
    serve(c, time, [
      input(
        c,
        'agenda.requested',
        { person: p.id, request: { type: 'commit', commitment: commitment as never } },
        time,
      ),
    ]);
  } else p.agenda.commitments.push({ ...definition, id, status: 'active' } as never);
  return { ...definition, id, status: 'active' } as unknown as import('./hf-person.ts').Commitment;
}
export function adoptGoal(
  p: Person,
  definition: Record<string, unknown>,
  now = p.now,
): import('./hf-person.ts').Goal {
  const c = context(p),
    id = `goal:${p.id}:${c.next}`,
    time = at(c, now),
    goal = {
      ...definition,
      id,
      progress: 0,
      completionHalfLifeMs: 30 * 86400000,
      baseImportance: definition.importance,
      ...(definition.deadline ? { deadline: Number(definition.deadline) * MS } : {}),
    };
  serve(c, time, [
    input(c, 'agenda.requested', { person: p.id, request: { type: 'goal', goal: goal as never } }, time),
  ]);
  return {
    ...definition,
    id,
    progress: 0,
    status: 'active',
    adoptedAt: now,
  } as unknown as import('./hf-person.ts').Goal;
}
export function abandonGoal(p: Person, id: string): void {
  const c = context(p);
  bridgeDefer(c, 'agenda.requested', { person: p.id, request: { type: 'abandon-goal', goalId: id } }, p.now);
}
export function seedTie(p: Person, tie: Record<string, unknown>): void {
  if (personRun(p)) throw new Error('Seed ties only before admission');
  p.social.relationships.push({ ...tie, respect: 0.5, ledger: 0, lastInteraction: 0 } as never);
}

export type SimEvent = {
  kind: 'finish' | 'died' | 'continue';
  at: number;
  personId: string;
  affordanceId?: string;
};
export type MarriageCustom = {
  id: string;
  minAgeYears: number;
  forbiddenKin: readonly string[];
  guardianForBride: boolean;
  mourningDays: { widow: number; widower: number };
  maxSpouses: number;
  pairing: string;
};
export function glimpsePerson(observer: Person, target: Person, time: number, clarity: number): void {
  if (!personRun(observer)) return; // Opening acquaintance authoring is retained separately, never backdated into a Run.
  const c = context(observer);
  if (time > observer.now) {
    c.glimpses ??= [];
    c.glimpses.push({ observer: observer.id, target: target.id, at: time, clarity });
    return;
  }
  const stamp = at(c, time),
    run = communityRun(c);
  const condition = need(
    HF.inspect(run, { perspective: { kind: 'host' }, people: [target.id], select: ['condition'] }),
  );
  const part = condition.people[0]?.parts.find((x) => x.select === 'condition');
  if (!part) throw new Error('HF supplied no outward signs');
  serve(c, stamp, [
    input(
      c,
      'person.glimpsed',
      {
        person: observer.id,
        evidenceId: `glimpse:${c.next}`,
        target: target.id,
        clarity,
        signs: (part.value as unknown as { outwardSigns: never }).outwardSigns,
      },
      stamp,
    ),
  ]);
}
export * from './hf-lifecycle.ts';

export { at as bridgeAt, context as bridgeContext, input as bridgeInput };

export function bridgeDefer(
  c: Community,
  kind: keyof HF.Payloads,
  payload: HF.Payloads[keyof HF.Payloads],
  minute: number,
): void {
  if (c.staging) {
    c.staging.deferred ??= [];
    c.staging.deferred.push({ kind, payload });
    return;
  }
  const stamp = at(c, minute);
  serve(c, stamp, [input(c, kind, payload, stamp)]);
}

export function lastPlace(p: Person): string | undefined {
  const c = context(p);
  return (c.staging ?? c).places?.[p.id];
}
