import { exportRun, step as nativeStep, preview, replay } from '@adam0white/human-framework';
import { type PersonaRequest, portableWriteBlockers, projectPortablePerson } from '@adam0white/lab-client';
import { describe, expect, it } from 'vitest';
import { CAST_IDS } from '../src/sim/cast.ts';
import { act, fingerprint, newGame, save, step } from '../src/sim/game.ts';
import {
  archiveCommunity,
  bridgeDefer,
  bridgeInput,
  conceive,
  createCommunity,
  need,
  serve,
  stepCommunity,
  type World,
} from '../src/sim/hf.ts';
import { createPerson, personFromAuthoring, personRun, portableFromPerson } from '../src/sim/hf-person.ts';
import { checkpointTransfer } from '../src/sim/passport.ts';
import { CastSession, type Shelf } from '../src/ui/cast-session.ts';
import { required } from './required.ts';

function opening() {
  const p = createPerson({ id: 'worker', name: 'Worker', seed: 7, sex: 'female', bornAt: -30 * 525600 });
  const community = createCommunity([p]);
  let grain = 0;
  const world = (candidate = false, quantity = grain): World => ({
    now: () => 0,
    affordancesFor: () => [
      {
        id: 'cut',
        action: 'reap',
        label: 'cut barley',
        duration: 120,
        effort: 0.2,
        advertises: { competence: 0.3 },
        tags: ['work'],
      },
    ],
    perceptsFor: () => [],
    scarcityFor: () => 0,
    beginOptions: () => undefined,
    resolve: (_p, a, reason) => {
      if (candidate) quantity += 2;
      else grain += 2;
      return {
        at: a.endsAt,
        action: a.action,
        affordanceId: a.affordanceId,
        status: reason === 'ended' ? 'completed' : 'interrupted',
      };
    },
    stage: () => ({
      world: world(true, grain),
      publish: () => {
        grain = quantity;
      },
    }),
  });
  // Each stage gets its own quantity and publishes only after HF accepts the batch.
  const w: World = {
    ...world(),
    stage: () => {
      let staged = grain;
      return {
        world: {
          ...world(),
          resolve: (_p, a, reason) => {
            if (reason === 'ended') staged += 2;
            return {
              at: a.endsAt,
              action: a.action,
              affordanceId: a.affordanceId,
              status: reason === 'ended' ? 'completed' : 'interrupted',
            };
          },
        },
        publish: () => {
          grain = staged;
        },
      };
    },
  };
  return { p, community, world: w, grain: () => grain };
}
describe('the HF4 world boundary', () => {
  it('restores accepted active work, finishes physical work once, and verifies native replay', () => {
    const a = opening();
    a.community.fidelity = { mode: 'daily', dayMs: 86400000, anchor: 0 };
    stepCommunity(a.community, a.world, 1);
    expect(a.p.activity?.action).toBe('reap');
    expect(a.grain()).toBe(0);
    const state = JSON.parse(JSON.stringify(archiveCommunity(a.community)));
    const source = need(replay(state.archive));
    expect(source.verified).toBe(true);
    expect(source.fullHash).toBe(state.archive.hashes.full);
    const p = personFromAuthoring(required(state.archive.initial.people[0]));
    const b = opening();
    const restored = createCommunity([p], state);
    expect(restored.fidelity).toEqual(a.community.fidelity);
    restored.world = b.world;
    serve(a.community, 120 * 60000);
    serve(restored, 120 * 60000);
    expect(exportRun(required(restored.run))).toEqual(exportRun(required(a.community.run)));
    expect(a.grain()).toBe(2);
    expect(b.grain()).toBe(2);
    expect(restored.active.worker).toBeUndefined();
  });
  it('retains unresolved request identities and keeps a hypothetical preview pure', () => {
    const a = opening(),
      c = a.community;
    c.offers.worker = a.world.affordancesFor(a.p);
    c.revisions.worker = 1;
    const base = {
      id: 'cut',
      actionId: 'reap',
      label: 'cut barley',
      person: 'worker',
      durationMs: 120 * 60000,
      participants: [],
      alongside: [],
      demands: { effort: 0.2, focus: 0, mode: 'awake' as const, requires: {} },
      tags: ['work'],
      norms: [],
      expected: { needs: { competence: 0.3 }, followedBy: [], provenance: ['authored:Valley test'] },
      fulfills: [],
      advances: [],
      diminishes: [],
    };
    const result = need(
      nativeStep(required(c.run), {
        until: 0,
        inputs: [
          bridgeInput(c, 'offers.received', { person: 'worker', revision: 1, offers: [base] }, 0),
          bridgeInput(
            c,
            'decision.requested',
            { person: 'worker', reason: 'test work', treatment: 'ordinary', offerRevision: 1 },
            0,
          ),
        ],
      }),
    );
    expect(result.boundary.type).toBe('world-required');
    const before = exportRun(required(c.run));
    const restored = createCommunity(
      [personFromAuthoring(required(before.initial.people[0]))],
      archiveCommunity(c),
    );
    expect(exportRun(required(restored.run)).current.pending).toEqual(before.current.pending);
    need(
      preview(required(c.run), {
        perspective: { kind: 'person', observer: 'worker' },
        person: 'worker',
        until: 60000,
        inputs: [],
      }),
    );
    expect(exportRun(required(c.run))).toEqual(before);
  });
});

it('does not publish a physical result when HF rejects its receipt', () => {
  const a = opening();
  stepCommunity(a.community, a.world, 1);
  let published = 0;
  const priorQueue = [
    {
      kind: 'context.received' as const,
      payload: {
        person: 'worker',
        evidenceId: 'accepted-earlier',
        context: { kind: 'scarcity' as const, value: 0.2 },
      },
    },
  ];
  a.community.deferred = structuredClone(priorQueue);
  a.community.world = {
    ...a.world,
    stage: () => ({
      world: {
        ...a.world,
        resolve: (_p, act) => {
          bridgeDefer(
            a.community,
            'context.received',
            {
              person: 'worker',
              evidenceId: 'rejected-physical-result',
              context: { kind: 'scarcity', value: 0.8 },
            },
            act.endsAt,
          );
          return {
            at: act.endsAt,
            action: act.action,
            affordanceId: act.affordanceId,
            status: 'completed',
            needs: { meaning: NaN },
          };
        },
      },
      publish: () => {
        published++;
      },
    }),
  };
  expect(() => serve(a.community, 120 * 60000)).toThrow();
  expect(published).toBe(0);
  expect(a.community.deferred).toEqual(priorQueue);
  expect(a.grain()).toBe(0);
  expect(a.community.active.worker?.activity.action).toBe('reap');
});

it('forwards a queued interruption at its real boundary and settles partial work once', () => {
  const a = opening();
  stepCommunity(a.community, a.world, 1);
  const interruptedId = a.community.active.worker?.id;
  let now = 1;
  let useful = 0;
  const world: World = {
    ...a.world,
    now: () => now,
    stage: () => {
      let candidate = useful;
      return {
        world: {
          ...a.world,
          resolve: (p, activity, reason) => {
            candidate += p.now - activity.startedAt;
            return {
              at: p.now,
              action: activity.action,
              affordanceId: activity.affordanceId,
              status: reason === 'interrupted' ? 'interrupted' : 'completed',
            };
          },
        },
        publish: () => {
          useful = candidate;
        },
      };
    },
  };
  const queued = { at: 30, reason: 'the remaining request ended' };
  a.community.interrupts.worker = queued;
  stepCommunity(a.community, world, 15);
  expect(a.community.interrupts.worker).toEqual(queued);
  expect(useful).toBe(0);
  now = 15;
  stepCommunity(a.community, world, 31);
  expect(a.community.interrupts.worker).toBeUndefined();
  expect(useful).toBe(30);
  expect(a.community.active.worker?.id).not.toBe(interruptedId);
  const archive = exportRun(required(a.community.run));
  const inputs = archive.history.flatMap((entry) => entry.inputs);
  const interrupted = inputs.filter((entry) => entry.kind === 'activity.interrupted');
  expect(interrupted).toHaveLength(1);
  expect(interrupted[0]?.at).toBe(30 * 60000);
  expect(
    inputs.find((entry) => entry.kind === 'action.resolved' && entry.payload.stage === 'interrupt'),
  ).toMatchObject({ payload: { outcome: { status: 'interrupted', end: 30 * 60000 } } });
  expect(need(replay(archive)).fullHash).toBe(archive.hashes.full);
});

it('keeps a queued interruption and active work when native admission refuses the input', () => {
  const a = opening();
  stepCommunity(a.community, a.world, 1);
  const queued = { at: 1, reason: 42 as unknown as string };
  a.community.interrupts.worker = queued;
  const before = exportRun(required(a.community.run));
  expect(() => stepCommunity(a.community, { ...a.world, now: () => 1 }, 2)).toThrow();
  expect(a.community.interrupts.worker).toEqual(queued);
  expect(a.community.active.worker?.activity.action).toBe('reap');
  expect(exportRun(required(a.community.run))).toEqual(before);
  expect(a.grain()).toBe(0);
});

it('does not publish a family completion when HF rejects its receipt', () => {
  const a = opening();
  const guardian = createPerson({ id: 'omer', name: 'Omer', seed: 7, sex: 'male', bornAt: -30 * 525600 });
  const c = createCommunity([guardian]);
  const familyWorld: World = {
    ...a.world,
    stage: undefined,
    affordancesFor: () => [
      {
        id: 'approval',
        action: 'approve-match',
        label: 'Approve',
        duration: 10,
        effort: 0,
        advertises: { belonging: 0.2, leisure: 0.2 },
      },
    ],
  };
  for (let minute = 1; minute <= 30 && !c.active.omer; minute++) stepCommunity(c, familyWorld, minute);
  expect(c.active.omer?.activity.action).toBe('approve-match');
  const endsAt = required(c.active.omer).activity.endsAt;
  c.world = {
    ...familyWorld,
    stage: () => ({
      world: {
        ...familyWorld,
        resolve: (_p, act) => ({
          at: act.endsAt,
          action: act.action,
          affordanceId: act.affordanceId,
          status: 'completed',
          needs: { meaning: NaN },
        }),
      },
      publish: () => {},
    }),
  };
  expect(() => serve(c, endsAt * 60000)).toThrow();
  expect(c.familyCompleted ?? []).toEqual([]);
  expect(c.active.omer?.activity.action).toBe('approve-match');
});

it('discards staged conversation and lifecycle inputs when a resolver receipt is rejected', () => {
  const people = ['speaker', 'listener'].map((id) =>
    createPerson({ id, name: id, sex: 'female', seed: 1, bornAt: -30 * 525600 }),
  );
  const c = createCommunity(people);
  let published = 0;
  let staged: typeof c | undefined;
  const world: World = {
    now: () => 0,
    affordancesFor: () => [
      {
        id: 'talk',
        action: 'chat',
        label: 'talk',
        placeId: 'common',
        duration: 120,
        effort: 0,
        advertises: { belonging: 0.5 },
        tags: ['social'],
      },
    ],
    perceptsFor: () => [],
    scarcityFor: () => 0,
    beginOptions: () => undefined,
    colocated: () => true,
    resolve: (_p, a) => ({
      at: a.endsAt,
      action: a.action,
      affordanceId: a.affordanceId,
      status: 'completed',
    }),
  };
  stepCommunity(c, world, 1);
  expect(people.every((p) => p.activity?.action === 'chat')).toBe(true);
  const priorQueue = [
    {
      kind: 'context.received' as const,
      payload: {
        person: 'speaker',
        evidenceId: 'earlier',
        context: { kind: 'scarcity' as const, value: 0.2 },
      },
    },
  ];
  c.deferred = structuredClone(priorQueue);
  const active = structuredClone(c.active);
  c.world = {
    ...world,
    stage: () => ({
      world: {
        ...world,
        resolve: (p, a) => {
          staged = c.staging;
          conceive(p, required(people.find((other) => other.id !== p.id)), 1, a.endsAt);
          return {
            at: a.endsAt,
            action: a.action,
            affordanceId: a.affordanceId,
            status: 'completed',
            needs: { meaning: NaN },
          };
        },
      },
      publish: () => {
        published++;
      },
    }),
  };
  expect(() => serve(c, 120 * 60000)).toThrow();
  expect(staged?.deferred?.map((item) => item.kind)).toEqual(
    expect.arrayContaining(['conversation.requested', 'lifecycle.received']),
  );
  expect(c.deferred).toEqual(priorQueue);
  expect(c.active).toEqual(active);
  expect(published).toBe(0);
  expect(
    exportRun(required(c.run))
      .history.flatMap((t) => t.inputs)
      .some((i) => i.kind === 'lifecycle.received' || i.kind === 'conversation.requested'),
  ).toBe(false);
});

it('records actual communication delivery only for awake people attending together', () => {
  const people = ['speaker', 'listener'].map((id) =>
    createPerson({ id, name: id, sex: 'female', seed: 1, bornAt: -30 * 525600 }),
  );
  const c = createCommunity(people);
  const w: World = {
    now: () => 0,
    affordancesFor: () => [
      {
        id: 'talk',
        action: 'chat',
        label: 'talk together',
        placeId: 'common',
        duration: 120,
        effort: 0,
        advertises: { belonging: 0.5 },
        tags: ['social'],
      },
    ],
    perceptsFor: () => [],
    scarcityFor: () => 0,
    beginOptions: () => undefined,
    resolve: (_p, a) => ({
      at: a.endsAt,
      affordanceId: a.affordanceId,
      action: a.action,
      status: 'completed',
    }),
    colocated: (a, b) => a.activity?.affordance.placeId === b.activity?.affordance.placeId,
  };
  stepCommunity(c, w, 1);
  expect(people.every((p) => p.activity?.action === 'chat')).toBe(true);
  const at = c.ingress + 1;
  serve(c, at, [
    bridgeInput(
      c,
      'conversation.requested',
      {
        speaker: 'speaker',
        listener: 'listener',
        topicIds: [],
        maxClaims: 0,
        temptations: [],
        loyalWarning: false,
      },
      at,
    ),
  ]);
  const receipts = exportRun(required(c.run)).current.receipts.communications;
  expect(receipts).toHaveLength(1);
  expect(receipts[0]?.receptions[0]?.recipient).toBe('listener');
  expect(receipts[0]?.receptions[0]?.itemIds.length).toBeGreaterThan(0);
});

it('keeps same-seed work and rest controls physically distinct under the real Run', () => {
  const work = opening();
  const rest = opening();
  const restWorld: World = {
    ...rest.world,
    affordancesFor: () => [
      {
        id: 'rest',
        action: 'rest',
        label: 'rest',
        duration: 120,
        effort: 0,
        advertises: { rest: 0.5 },
        tags: ['rest'],
      },
    ],
    stage: undefined,
    resolve: (_p, a) => ({
      at: a.endsAt,
      action: a.action,
      affordanceId: a.affordanceId,
      status: 'completed',
    }),
  };
  stepCommunity(work.community, work.world, 120);
  stepCommunity(rest.community, restWorld, 120);
  expect(work.grain()).toBe(2);
  expect(rest.grain()).toBe(0);
  expect(work.p.body.exertion).toBeGreaterThan(rest.p.body.exertion);
  expect(exportRun(required(work.community.run)).current.at).toBe(
    exportRun(required(rest.community.run)).current.at,
  );
});

it('releases five actual public visitors at accepted quiet boundaries and freezes portable native sources', async () => {
  const game = newGame(7, undefined, false, true, 'valley-public-2026-10');
  const ids = ['maryam', 'yusuf-usta', 'meryem-visitor', 'samira', 'danyal'];
  for (const person of ids) expect(act(game, { verb: 'release-cast', person })).toBe(true);
  step(game, 480);
  const hashes = new Map<string, string>();
  for (const id of ids) {
    const p = required(game.valley.castReleased?.[id]);
    const archive = exportRun(required(personRun(p)));
    const projection = portableFromPerson(p, required(CAST_IDS[id]), 'source-test');
    expect(projection.person.version).toBe(2);
    const peers = portableWriteBlockers(required(CAST_IDS[id]), 'valley');
    if (peers.length) {
      expect(() =>
        projectPortablePerson({
          castId: required(CAST_IDS[id]),
          game: 'valley',
          engine: '4.8.0',
          person: { id },
          history: [],
        }),
      ).toThrow('read-only until');
      expect(exportRun(required(personRun(p)))).toEqual(archive);
    }
    const checkpoint = await checkpointTransfer(p, required(CAST_IDS[id]), {
      game: 'valley',
      build: 'test',
      engine: '4.8.0',
      rules: 'valley-public-2026-10',
    });
    expect(checkpoint.source.archive).toEqual(archive);
    expect(need(replay(archive)).verified).toBe(true);
    hashes.set(id, archive.hashes.full);
  }
  // A save hashes its already detached state; the standalone fingerprint is identical.
  expect(save(game).fingerprint).toBe(fingerprint(game.valley));
  step(game, 1440);
  const main = exportRun(required(personRun(game.valley.kahya)));
  for (const id of ids) {
    const p = required(game.valley.castReleased?.[id]);
    expect(exportRun(required(personRun(p))).hashes.full).toBe(hashes.get(id));
    expect(personRun(p)).not.toBe(personRun(game.valley.kahya));
    expect(main.current.offers[id]?.offers).toEqual([]);
  }
}, 120000);

it('refuses shared checkpoint writes for actual released visitors', async () => {
  const game = newGame(7, undefined, false, true, 'valley-public-2026-10');
  const ids = ['maryam', 'yusuf-usta', 'meryem-visitor', 'samira', 'danyal'];
  for (const person of ids) expect(act(game, { verb: 'release-cast', person })).toBe(true);
  step(game, 480);
  const hashes = new Map(
    ids.map((id) => [
      id,
      exportRun(required(personRun(required(game.valley.castReleased?.[id])))).hashes.full,
    ]),
  );
  let writes = 0;
  const shelf: Shelf = {
    ready: Promise.resolve(true),
    enabled: true,
    setEnabled() {},
    async request<T>(_request: PersonaRequest): Promise<T> {
      writes++;
      return true as T;
    },
  };
  const session = new CastSession(
    {
      setPersonaRecording() {},
      allowPersonaRecording() {},
      personaRecordingAllowed: false,
      build: () => ({}),
    },
    shelf,
  );
  session.game = game;
  const beforeHeads = structuredClone(session.heads);
  await session.checkpoint(true);
  expect(writes).toBe(0);
  expect(session.heads).toEqual(beforeHeads);
  expect(session.status).toContain('read-only until');
  for (const id of ids)
    expect(exportRun(required(personRun(required(game.valley.castReleased?.[id])))).hashes.full).toBe(
      hashes.get(id),
    );
}, 120000);

it('preserves authored pay, risk, skill, capacities, forecast and actual outcome evidence at the public boundary', () => {
  const p = createPerson({
    id: 'farmer',
    name: 'Farmer',
    seed: 7,
    sex: 'female',
    bornAt: -30 * 525600,
    skills: { farming: 0.3 },
  });
  p.agenda.goals.push({
    id: 'field-task',
    label: 'cut the field',
    serves: ['meaning'],
    advancedBy: [{ action: 'reap', amount: 1 }],
    importance: 1,
    progress: 0,
    status: 'active',
    adoptedAt: 0,
  });
  const c = createCommunity([p]);
  const w: World = {
    now: () => 0,
    affordancesFor: () => [
      {
        id: 'cut',
        action: 'reap',
        label: 'cut barley',
        duration: 60,
        effort: 0.2,
        focus: 0.1,
        advertises: { competence: 0.2 },
        material: 2,
        risk: { chance: 0.1, severity: 0.2, kind: 'caught' },
        skill: { id: 'farming', difficulty: 0.3 },
        requires: { moving: 0.1 },
        advances: ['field-task'],
        followedBy: [{ label: 'walk home', duration: 20, effort: 0.1 }],
        forecastAt: { comfortAt: 0.2, spentAt: 0.8 },
      },
    ],
    perceptsFor: () => [],
    scarcityFor: () => 0,
    beginOptions: () => undefined,
    resolve: (_p, a) => ({
      at: a.endsAt,
      action: a.action,
      affordanceId: a.affordanceId,
      status: 'completed',
      targetId: p.id,
      material: 3,
      quality: 0.9,
      practice: { quality: 0.8 },
      needs: { competence: 0.2, food: 0.1 },
      summary: 'The cut barley was carried home.',
      advances: ['field-task'],
      percepts: [
        {
          at: a.endsAt,
          channel: 'outcome',
          kind: 'harvest',
          actorId: p.id,
          salience: 0.5,
          summary: 'The barley is cut.',
        },
      ],
    }),
  };
  stepCommunity(c, w, 61);
  const archive = exportRun(required(c.run));
  const inputs = archive.history.flatMap((t) => t.inputs);
  const offered = inputs.find((i) => i.kind === 'offers.received');
  if (offered?.kind !== 'offers.received') throw Error('Missing actual offer receipt');
  expect(offered.payload.offers[0]).toMatchObject({
    demands: {
      effort: 0.2,
      focus: 0.1,
      requires: { moving: 0.1 },
      skill: { id: 'farming', difficulty: 0.3, domain: 'general' },
    },
    expected: {
      material: 2,
      risk: { chance: 0.1, severity: 0.2, kind: 'caught' },
      followedBy: [{ durationMs: 1200000, effort: 0.1 }],
      forecastAt: { comfortAt: 0.2, spentAt: 0.8 },
    },
    advances: ['field-task'],
  });
  const completed = inputs.find(
    (i) => i.kind === 'action.resolved' && i.payload.outcome?.status === 'completed',
  );
  if (completed?.kind !== 'action.resolved') throw Error('Missing actual completion');
  expect(completed.payload.outcome).toMatchObject({
    target: p.id,
    summary: 'The cut barley was carried home.',
    quality: 0.9,
    actual: {
      material: 3,
      practice: { quality: 0.8 },
      psychological: { competence: 0.2 },
      consumed: { food: 0.1 },
    },
    advances: ['field-task'],
  });
  expect(completed.payload.observations[0]?.percepts[0]?.summary).toBe('The barley is cut.');
  expect(p.skills.farming?.practice).toBeGreaterThan(0);
  expect(need(replay(archive)).fullHash).toBe(archive.hashes.full);
});
