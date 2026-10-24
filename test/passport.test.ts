import { createPerson, MINUTES_PER_YEAR, snapshot } from '@adam0white/human-framework';
import { createPersona, initialPersonaLife, preparePersonaLife } from '@adam0white/lab-client';
import { expect, it } from 'vitest';
import { admitCast, calendarPassport, checkpointReceipt } from '../src/sim/passport.ts';
import { foundValley } from '../src/sim/people.ts';
import { hunchOf } from '../src/sim/valley.ts';

// Synthetic unit control; not a browser journey or evidence of a played source.
async function source(role = 'danyal') {
  const cast = ALLOCATION.find((c) => c.castId === `hf.cast.${role}.well`);
  if (!cast) throw new Error('missing fixture cast');
  const p = createPerson({
    id: role,
    name: cast.name,
    sex: role === 'maryam' ? 'female' : 'male',
    seed: 7,
    now: 707,
    bornAt: 707 - cast.age * MINUTES_PER_YEAR,
    body: { fitness: 0.73 },
    skills: { farming: 0.64, unrelated: 0.9 },
    traits: { openness: 0.7 },
  });
  const raw = snapshot(p);
  return createPersona({
    format: 'hf-persona/1',
    castId: cast.castId,
    castRevision: '1',
    branchId: `unit-${role}`,
    parentRevision: null,
    source: { game: 'well', build: 'unit-control', engine: '2.17.0', rules: 'unit' },
    transfer: {
      castPassport: 'site-cast/1',
      sourceRole: role,
      person: calendarPassport(p, 'site-cast-calendar/1'),
      checkpoint: await checkpointReceipt(raw),
      life: initialPersonaLife(cast.castId, `unit-${role}`, 0),
    },
    limitations: [],
  });
}
it('admits an explicit site dialect while carrying actual fitness, RNG and supported practice', async () => {
  const envelope = await source();
  const opening = foundValley(42, 0).people.find((p) => p.id === 'danyal');
  if (!opening) throw new Error('missing actor');
  const admitted = admitCast(opening, preparePersonaLife(envelope, 26 * 3600000));
  expect(admitted.person.body.fitness).toBe(0.73);
  expect(admitted.person.rng).toEqual((envelope.transfer.person as { person: { rng: unknown } }).person.rng);
  expect(admitted.person.skills.farming?.level).toBe(0.64);
  expect(admitted.person.skills.unrelated).toBeUndefined();
  expect(admitted.limitations.join(' ')).toContain('unrelated');
});
it('refuses a public profile or an unregistered source role before admission', async () => {
  const envelope = await source();
  const opening = foundValley(42, 0).people.find((p) => p.id === 'danyal');
  if (!opening) throw new Error('missing actor');
  expect(() =>
    admitCast(
      opening,
      preparePersonaLife(
        { ...envelope, transfer: { ...envelope.transfer, castPassport: 'authored-cast/1' } },
        0,
      ),
    ),
  ).toThrow('dialect');
  expect(() =>
    admitCast(
      opening,
      preparePersonaLife({ ...envelope, transfer: { ...envelope.transfer, sourceRole: 'yusuf' } }, 0),
    ),
  ).toThrow('role');
});

import { acceptPersonaBatch, type PersonaRequest, type PersonaShelfState } from '@adam0white/lab-client';
import { ALLOCATION } from '../src/sim/cast.ts';
import { act, fingerprint, load, replay, save, step } from '../src/sim/game.ts';
import { CastSession, type Shelf } from '../src/ui/cast-session.ts';

class FakeShelf implements Shelf {
  ready = Promise.resolve(true);
  enabled = true;
  state: PersonaShelfState = { heads: {}, revisions: [] };
  preparations = 0;
  writes = 0;
  race = false;
  setEnabled(v: boolean) {
    this.enabled = v;
  }
  async request<T>(q: PersonaRequest): Promise<T> {
    if (q.action === 'prepareBatch') {
      this.preparations++;
      return {
        expectedHeads: Object.fromEntries((q.castIds ?? []).map((id) => [id, this.state.heads[id] ?? null])),
        inputs: this.state.revisions
          .filter((p) => this.state.heads[p.castId] === p.revision && (q.castIds ?? []).includes(p.castId))
          .map((p) => preparePersonaLife(p, 26 * 3600000)),
        blocked: [],
      } as T;
    }
    if (q.action === 'putBatch') {
      if (this.race) throw new Error('stale parent');
      this.state = acceptPersonaBatch(this.state, q.envelopes ?? [], q.expectedHeads);
      this.writes++;
      return true as T;
    }
    if (q.action === 'recordingBatch')
      return {
        sameEpoch: false,
        revisions: (q.envelopes ?? []).map((p) => p.revision),
        recordingEpoch: 'unit-epoch',
      } as T;
    throw new Error('unexpected ' + q.action);
  }
}
function fakeLab() {
  let allowed = false;
  return {
    build: () => ({ c: 'unit' }),
    get personaRecordingAllowed() {
      return allowed;
    },
    setPersonaRecording: () => {
      allowed = false;
    },
    allowPersonaRecording: (v: boolean) => {
      allowed = v;
    },
  };
}
it('claims all applicable heads together, pins all actors, and keeps loaded/file history separate', async () => {
  const shelf = new FakeShelf();
  const parent = await source();
  const second = await source('maryam');
  shelf.state = {
    heads: { [parent.castId]: parent.revision, [second.castId]: second.revision },
    revisions: [parent, second],
  };
  const lab = fakeLab();
  const session = new CastSession(lab, shelf);
  const g = await session.fresh(42);
  expect(lab.personaRecordingAllowed).toBe(false); // Prior ledger cannot be recorded before installation.
  expect(g.cast?.people && Object.keys(g.cast.people)).toHaveLength(ALLOCATION.length);
  expect(shelf.writes).toBe(1);
  const fp = fingerprint(g.valley);
  expect(fingerprint(replay(42, g.inputs, g.valley.minute, g.cast).valley)).toBe(fp);
  const metadata = session.metadata();
  const saved = save(g);
  await session.loaded(load(saved), metadata);
  expect(shelf.preparations).toBe(1);
  expect(Object.keys(session.heads)).toHaveLength(2);
  await session.loaded(load(saved), metadata, true);
  expect(session.heads).toEqual({});
  expect(session.fileOrigin).toBe(true);
  expect(lab.personaRecordingAllowed).toBe(false);
  await session.queryRecording(true);
  expect(lab.personaRecordingAllowed).toBe(true);
  session.invalidate();
  expect(lab.personaRecordingAllowed).toBe(false);
});
it('starts no game and accepts no partial claim when the batch loses CAS', async () => {
  const shelf = new FakeShelf();
  const p = await source();
  shelf.state = { heads: { [p.castId]: p.revision }, revisions: [p] };
  shelf.race = true;
  const session = new CastSession(fakeLab(), shelf);
  await expect(session.fresh(42)).rejects.toThrow('stale parent');
  expect(session.game).toBeNull();
  expect(shelf.state.heads[p.castId]).toBe(p.revision);
});
it('does not release a visitor during UI prediction', () => {
  const g = newGameForControl();
  act(g, { verb: 'release-cast', person: 'danyal' });
  const target = g.valley.people.find((p) => p.id === 'danyal');
  if (!target) throw new Error('missing control actor');
  target.activity = null; // Synthetic idle boundary, not a browser source.
  const before = fingerprint(g.valley);
  hunchOf(g.valley, g.valley.kahya, target, 'build-mill');
  expect(fingerprint(g.valley)).toBe(before);
});
it('actually pauses a visitor with complete duties at a natural boundary and replays the pause', () => {
  const g = newGameForControl();
  act(g, { verb: 'release-cast', person: 'danyal' });
  step(g, 10 * 1440);
  expect(g.valley.castReleased?.danyal?.activity).toBeNull();
  expect(g.valley.households.find((h) => h.id === 'water-guest')?.members).not.toContain('danyal');
  const fp = fingerprint(g.valley);
  expect(fingerprint(replay(42, g.inputs, g.valley.minute).valley)).toBe(fp);
});

import { newGame as newGameForSeed } from '../src/sim/game.ts';

function newGameForControl() {
  return newGameForSeed(42);
}

it('ignores a positive recording acknowledgement after the run/identity generation changes', async () => {
  const shelf = new FakeShelf();
  const p = await source();
  shelf.state = { heads: { [p.castId]: p.revision }, revisions: [p] };
  const lab = fakeLab();
  const session = new CastSession(lab, shelf);
  await session.fresh(42);
  let respond: ((value: unknown) => void) | undefined;
  const normal = shelf.request.bind(shelf);
  shelf.request = async <T>(request: PersonaRequest): Promise<T> => {
    if (request.action === 'recordingBatch')
      return new Promise<T>((resolve) => {
        respond = resolve as (v: unknown) => void;
      });
    return normal<T>(request);
  };
  const pending = session.queryRecording(true);
  session.invalidate();
  respond?.({
    sameEpoch: true,
    revisions: Object.values(session.heads).map((p) => p.revision),
    recordingEpoch: 'old-epoch',
  });
  await pending;
  expect(lab.personaRecordingAllowed).toBe(false);
});

import { acceptPersona } from '@adam0white/lab-client';

it('closes an owned branch on death and preserves its terminal receipt after local reload', async () => {
  const shelf = new FakeShelf();
  const p = await source();
  shelf.state = { heads: { [p.castId]: p.revision }, revisions: [p] };
  const normal = shelf.request.bind(shelf);
  shelf.request = async <T>(request: PersonaRequest): Promise<T> => {
    if (request.action === 'put' && request.envelope) {
      shelf.state = acceptPersona(shelf.state, request.envelope);
      return true as T;
    }
    return normal<T>(request);
  };
  const session = new CastSession(fakeLab(), shelf);
  const g = await session.fresh(42);
  const actor = g.valley.people.find((p) => p.id === 'danyal');
  if (!actor) throw new Error('missing actor');
  const dead = snapshot(actor);
  dead.body.alive = false;
  dead.now = 600;
  // Synthetic death-event control only, never browser journey evidence.
  g.valley.castDeaths = { danyal: dead };
  await session.checkpoint();
  const terminal = session.heads['hf.cast.danyal.well'];
  expect(terminal?.terminal).toEqual({ kind: 'dead', at: 600 });
  if (!terminal) throw new Error('missing terminal');
  expect(() => preparePersonaLife(terminal, 30 * 3600000)).toThrow('closed');
  await session.loaded(load(save(g)), session.metadata());
  expect(session.heads['hf.cast.danyal.well']?.terminal?.kind).toBe('dead');
});
