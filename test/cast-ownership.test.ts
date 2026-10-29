import { createPerson, createRun, exportRun, inspect } from '@adam0white/human-framework';
import {
  acceptPersona,
  acceptPersonaBatch,
  canonicalCast,
  createPersona,
  initialPersonaLife,
  type PersonaEnvelope,
  type PersonaRequest,
  type PersonaShelfState,
  preparePersonaLife,
} from '@adam0white/lab-client';
import { expect, it } from 'vitest';
import { ALLOCATION } from '../src/sim/cast.ts';
import { PUBLIC_EDITION } from '../src/sim/edition.ts';
import { CastSession, type Shelf } from '../src/ui/cast-session.ts';
import { authoredPerson, exampleSpec, MINUTE, need, START } from './hf-fixture.ts';
import { required } from './required.ts';

async function source() {
  const cast = canonicalCast('hf.cast.yusuf.well');
  const spec = exampleSpec();
  spec.host.id = 'lefthand';
  spec.definitions.sources = spec.definitions.sources.map((s) =>
    s.type === 'host' ? { ...s, id: 'lefthand' } : s,
  );
  const run = need(createRun(spec));
  const person = authoredPerson('yusuf', 'Yusuf', 'male');
  person.identity.castId = cast.castId;
  person.biography = [
    {
      id: 'e1',
      at: START - MINUTE,
      kind: 'observation',
      valence: 0,
      salience: 0.5,
      summary: 'Yusuf watched the source work.',
      tags: [],
      basis: { kind: 'authored', author: 'lefthand' },
      provenance: ['lefthand'],
    },
  ];
  person.state.sourceTrust = [{ sourceId: 'player', trust: 0.6 }];
  need(createPerson(run, person));
  const projected = need(
    inspect(run, {
      perspective: { kind: 'host' },
      people: ['yusuf'],
      select: ['persona'],
      portable: { person: 'yusuf', castId: cast.castId, castRevision: cast.revision },
    }),
  );
  const portable = projected.people[0]?.parts.find((p) => p.select === 'persona')?.value;
  return createPersona({
    format: 'hf-persona/1',
    castId: cast.castId,
    castRevision: cast.revision,
    branchId: 'valley-arrival-control',
    parentRevision: null,
    source: { game: 'lefthand', build: 'test', engine: '4.8.0', rules: 'test' },
    transfer: {
      castPassport: 'hf-portable-person/2',
      portable,
      life: initialPersonaLife(cast.castId, 'valley-arrival-control', 0),
    },
    limitations: [],
  });
}
const lab = () => ({
  setPersonaRecording() {},
  allowPersonaRecording() {},
  personaRecordingAllowed: false,
  build() {
    return {};
  },
});
function shelfFor(parent: PersonaEnvelope, conflict = false) {
  let state: PersonaShelfState = acceptPersona({ revisions: [], heads: {} }, parent);
  let writes = 0;
  const shelf: Shelf = {
    ready: Promise.resolve(true),
    enabled: true,
    setEnabled() {},
    async request<T>(request: PersonaRequest): Promise<T> {
      if (request.action === 'prepareBatch')
        return {
          expectedHeads: Object.fromEntries(ALLOCATION.map((p) => [p.castId, state.heads[p.castId] ?? null])),
          inputs: [preparePersonaLife(parent, 0)],
          blocked: [],
        } as T;
      if (request.action === 'put') {
        writes++;
        throw new Error('Unexpected shared write');
      }
      if (request.action === 'putBatch') {
        writes++;
        if (conflict) throw new Error('The source head changed.');
        state = acceptPersonaBatch(state, request.envelopes ?? [], request.expectedHeads);
        return true as T;
      }
      throw new Error(`Unexpected shelf request ${request.action}`);
    },
  };
  return { shelf, writes: () => writes, state: () => state };
}
it('refuses nonempty arrival writes without replacing the current game', async () => {
  const parent = await source();
  const fixture = shelfFor(parent);
  const session = new CastSession(lab(), fixture.shelf);
  const previous = await session.fresh(6, true, PUBLIC_EDITION);
  await expect(session.fresh(7, false, PUBLIC_EDITION)).rejects.toThrow('Yusuf: read-only until');
  expect(fixture.writes()).toBe(0);
  expect(session.game).toBe(previous);
  expect(fixture.state().heads[parent.castId]).toBe(parent.revision);
});

it('refuses alternative shared writes for the named blocked person', async () => {
  const parent = await source();
  const fixture = shelfFor(parent);
  const session = new CastSession(lab(), fixture.shelf);
  await session.fresh(7, true, PUBLIC_EDITION);
  session.heads[parent.castId] = parent;
  await session.alternative(parent.castId);
  expect(session.status).toContain('Yusuf: read-only until');
  expect(fixture.writes()).toBe(0);
});

it('blocks the terminal write for a genuinely deceased HF person', async () => {
  const { bridgeAt, bridgeInput, createCommunity, createPerson, serve } = await import('../src/sim/hf.ts');
  const { frozenPerson, personRun } = await import('../src/sim/hf-person.ts');
  const { newGame } = await import('../src/sim/game.ts');
  const dead = createPerson({ id: 'yusuf', name: 'Yusuf', seed: 1, now: 0, bornAt: -10000000, sex: 'male' });
  const listener = createPerson({
    id: 'listener',
    name: 'Listener',
    seed: 2,
    now: 0,
    bornAt: -10000000,
    sex: 'female',
  });
  const community = createCommunity([dead, listener]);
  const stamp = bridgeAt(community, 60);
  serve(community, stamp, [
    bridgeInput(
      community,
      'lifecycle.received',
      {
        type: 'death',
        person: { kind: 'actor', id: dead.id },
        basis: { evidence: { kind: 'evidence', id: 'death-at-60' }, worldRevision: community.revision ?? 0 },
      },
      stamp,
    ),
  ]);
  expect(dead.body.alive).toBe(false);
  const frozen = frozenPerson(dead);
  const archive = exportRun(required(personRun(frozen)));
  const parent = await source();
  const fixture = shelfFor(parent);
  const session = new CastSession(lab(), fixture.shelf);
  const game = newGame(7, undefined, false, true, PUBLIC_EDITION);
  game.valley.castDeaths = { yusuf: frozen };
  session.game = game;
  session.heads[parent.castId] = parent;
  // This component fixture is not a replayable Valley death; isolate the write gate.
  let validations = 0;
  (session as unknown as { publicationGuard: () => () => void }).publicationGuard = () => {
    validations++;
    return () => {};
  };
  await session.checkpoint();
  expect(validations).toBe(0);
  await session.checkpoint(true);
  expect(validations).toBe(1);
  expect(session.status).toContain('Yusuf: read-only until');
  expect(fixture.writes()).toBe(0);
  expect(session.heads[parent.castId]).toEqual(parent);
  expect(session.heads[parent.castId]?.terminal).toBeUndefined();
  expect(exportRun(required(personRun(frozen)))).toEqual(archive);
});

it('allows an empty arrival acknowledgment', async () => {
  const requests: PersonaRequest[] = [];
  const shelf: Shelf = {
    ready: Promise.resolve(true),
    enabled: true,
    setEnabled() {},
    async request<T>(request: PersonaRequest): Promise<T> {
      requests.push(request);
      if (request.action === 'prepareBatch')
        return {
          expectedHeads: Object.fromEntries(ALLOCATION.map((p) => [p.castId, null])),
          inputs: [],
          blocked: [],
        } as T;
      return true as T;
    },
  };
  const session = new CastSession(lab(), shelf);
  const game = await session.fresh(7, false, PUBLIC_EDITION);
  expect(game.cast?.inputs ?? []).toEqual([]);
  expect(requests.some((r) => r.action === 'putBatch' && r.envelopes?.length === 0)).toBe(true);
});

it('keeps native source out of local metadata and reconstructs only its exact frozen receipt', async () => {
  // Component fixture: this proves receipt persistence, not a played Valley departure.
  const { bindPerson, frozenPerson, personFromAuthoring } = await import('../src/sim/hf-person.ts');
  const { checkpointTransfer, HOST_RULES } = await import('../src/sim/passport.ts');
  const { newGame } = await import('../src/sim/game.ts');
  const cast = canonicalCast('hf.cast.samira.well');
  const spec = exampleSpec();
  spec.host.id = 'valley';
  spec.definitions.sources = spec.definitions.sources.map((s) =>
    s.type === 'host' ? { ...s, id: 'valley' } : s,
  );
  const authored = authoredPerson('samira', 'Samira');
  authored.identity.castId = cast.castId;
  const run = need(createRun(spec));
  need(createPerson(run, authored));
  const view = personFromAuthoring(authored);
  bindPerson(view, run);
  const frozen = frozenPerson(view);
  const session = new CastSession(lab(), null);
  const stamps = { game: 'valley', build: 'test', engine: '4.8.0', rules: HOST_RULES };
  const prepared = await checkpointTransfer(frozen, cast.castId, stamps);
  const envelope = await createPersona({
    format: 'hf-persona/1',
    castId: cast.castId,
    castRevision: cast.revision,
    branchId: 'source-ref-control',
    parentRevision: null,
    source: stamps,
    transfer: { ...prepared.transfer, hostRun: session.runId },
    limitations: [],
  });
  session.heads[cast.castId] = envelope;
  session.sources[cast.castId] = { revision: envelope.revision, person: prepared.source };
  const metadata = JSON.parse(JSON.stringify(session.metadata()));
  expect(metadata.sources).toEqual({});
  expect(metadata.sourceRefs).toEqual({
    [cast.castId]: {
      revision: envelope.revision,
      actorId: 'samira',
      fullHash: prepared.source.archive.hashes.full,
    },
  });
  expect(JSON.stringify(metadata)).not.toContain('hf-run');
  const game = newGame(7, undefined, false, true, PUBLIC_EDITION);
  game.valley.castReleased = { samira: frozen };
  const resumed = new CastSession(lab(), null);
  await resumed.loaded(game, metadata);
  expect(resumed.heads).toEqual(session.heads);
  expect(resumed.sources).toEqual(session.sources);
  const altered = structuredClone(metadata);
  altered.sourceRefs[cast.castId].fullHash = '0'.repeat(64);
  const rejected = new CastSession(lab(), null);
  await expect(rejected.loaded(game, altered)).rejects.toThrow('differs from the played game');
  expect(rejected.game).toBeNull();
  expect(session.heads[cast.castId]).toEqual(envelope);
});
