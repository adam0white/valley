import { createPerson, createRun, DEFAULT_NORMS, exportRun, inspect } from '@adam0white/human-framework';
import {
  admitPortablePerson,
  canonicalCast,
  createPersona,
  initialPersonaLife,
  portablePersonRole,
  preparePersonaLife,
  validatePortablePerson,
} from '@adam0white/lab-client';
import { expect, it } from 'vitest';
import { personFromAuthoring } from '../src/sim/hf-person.ts';
import {
  admitCast,
  checkpointReceipt,
  type NativeCastSource,
  prepareCastStart,
  validateCheckpointLineage,
  validateTerminalSource,
} from '../src/sim/passport.ts';
import { authoredPerson, exampleSpec, MINUTE, need, START } from './hf-fixture.ts';
import { required } from './required.ts';

async function source() {
  const cast = canonicalCast('hf.cast.yusuf.well');
  const spec = exampleSpec();
  spec.host.id = 'lefthand';
  spec.definitions.sources = spec.definitions.sources.map((s) =>
    s.type === 'host' ? { ...s, id: 'lefthand' } : s,
  );
  spec.definitions.actions = [
    ...spec.definitions.actions,
    {
      id: 'pray',
      label: 'pray',
      demands: { effort: 0, focus: 0, mode: 'awake', requires: {} },
      tags: [],
      norms: [],
    },
  ];
  spec.definitions.norms = [required(DEFAULT_NORMS.find((n) => n.id === 'salah'))];
  const run = need(createRun(spec));
  const authored = authoredPerson('yusuf', 'Yusuf', 'male');
  authored.identity.castId = cast.castId;
  authored.biography = [
    {
      id: 'e1',
      at: START - MINUTE,
      kind: 'observation',
      valence: 0,
      salience: 0.5,
      summary: 'A remembered source event.',
      tags: [],
      basis: { kind: 'authored', author: 'lefthand' },
      provenance: ['lefthand'],
    },
  ];
  authored.state.sourceTrust = [{ sourceId: 'player', trust: 0.6 }];
  authored.state.agenda.commitments = [
    {
      id: 'c1',
      kind: 'worship',
      toId: 'self',
      actions: ['pray'],
      normId: 'salah',
      from: START,
      until: START + 60 * MINUTE,
      importance: 0.5,
      label: 'prayer',
    },
  ];
  need(createPerson(run, authored));
  const view = need(
    inspect(run, {
      perspective: { kind: 'host' },
      people: ['yusuf'],
      select: ['persona'],
      portable: { person: 'yusuf', castId: cast.castId, castRevision: cast.revision },
    }),
  );
  const part = view.people[0]?.parts.find((p) => p.select === 'persona');
  if (!part) throw new Error('Missing portable projection');
  const life = initialPersonaLife(cast.castId, 'portable-test', 0);
  return createPersona({
    format: 'hf-persona/1',
    castId: cast.castId,
    castRevision: cast.revision,
    branchId: 'portable-test',
    parentRevision: null,
    source: { game: 'lefthand', build: 'test', engine: '4.8.0', rules: 'test' },
    transfer: { castPassport: 'hf-portable-person/2', portable: part.value, life },
    limitations: [],
  });
}
it('uses a real retained-v2 source and refuses an altered source identity', async () => {
  const parent = await source();
  expect(portablePersonRole(parent, 'lefthand')).toBe('yusuf');
  const retained = parent.transfer.portable as {
    retained: { memory: { episodes: unknown[]; sourceTrust: Record<string, number> } };
  };
  expect(retained.retained.memory.episodes.length).toBeGreaterThan(0);
  expect(retained.retained.memory.sourceTrust.player).toBe(0.6);
  const tampered = { ...parent, source: { ...parent.source, game: 'murmur' } };
  expect(() => portablePersonRole(tampered, 'lefthand')).toThrow();
});
it('installs retained history and prayer in the released Valley role', async () => {
  const parent = await source();
  const role = portablePersonRole(parent, 'valley');
  expect(role).toBe('yusuf');
  const opening = personFromAuthoring(authoredPerson('yusuf', 'Yusuf', 'male'));
  const admitted = admitCast(opening, preparePersonaLife(parent, 0));
  const target = exampleSpec();
  target.host.id = 'valley';
  target.definitions.sources = target.definitions.sources.map((s) =>
    s.type === 'host' ? { ...s, id: 'valley' } : s,
  );
  const portable = validatePortablePerson(parent.transfer.portable);
  if (portable.version !== 2) throw new Error('Expected retained source');
  // This synthetic target explicitly supports the source's prayer meaning and calendar.
  // HF checks every retained reference and requires exact norm definitions.
  target.definitions.calendar = structuredClone(portable.retained.calendar.definition);
  target.definitions.norms = portable.retained.calendar.norms.map((norm) => ({
    ...norm,
    provenance: { ...norm.provenance },
    sources: norm.sources.map((source) => ({ ...source })),
    exemptions: norm.exemptions.map((exemption) => ({
      ...exemption,
      provenance: { ...exemption.provenance },
      sources: exemption.sources.map((source) => ({ ...source })),
    })),
  }));
  target.definitions.actions = [
    ...target.definitions.actions,
    {
      id: 'pray',
      label: 'pray',
      demands: { effort: 0, focus: 0, mode: 'awake', requires: {} },
      tags: [],
      norms: [],
    },
  ];
  const run = need(createRun(target));
  expect(need(createPerson(run, admitted.person))).toBe(role);
  const view = need(
    inspect(run, {
      perspective: { kind: 'host' },
      people: [role],
      select: ['persona'],
      portable: { person: role, castId: parent.castId, castRevision: parent.castRevision },
    }),
  );
  const part = view.people[0]?.parts.find((p) => p.select === 'persona');
  const result = validatePortablePerson(part?.value);
  if (result.version !== 2) throw new Error('Retained history was lost');
  expect(result.retained.agenda.commitments[0]).toMatchObject({ actions: ['pray'], normId: 'salah' });
  expect(result.retained.memory.episodes).toEqual(portable.retained.memory.episodes);
  expect(result.retained.memory.sourceTrust.player).toBe(0.6);
});
it('rejects duplicate source inputs before constructing a batch', async () => {
  const input = preparePersonaLife(await source(), 0);
  expect(() => prepareCastStart([], [input, input])).toThrow('Invalid cast batch');
});

it('maps retained prayer and source history into a supported Left Hand Run', async () => {
  const parent = await source();
  const target = exampleSpec();
  target.host.id = 'lefthand';
  target.definitions.sources = target.definitions.sources.map((s) =>
    s.type === 'host' ? { ...s, id: 'lefthand' } : s,
  );
  target.definitions.actions = [
    ...target.definitions.actions,
    {
      id: 'prayer',
      label: 'pray',
      demands: { effort: 0, focus: 0, mode: 'awake', requires: {} },
      tags: [],
      norms: [],
    },
  ];
  target.definitions.norms = [required(DEFAULT_NORMS.find((n) => n.id === 'salah'))];
  const opening = authoredPerson('yusuf', 'Yusuf', 'male');
  opening.identity.castId = parent.castId;
  const admitted = admitPortablePerson(parent, 'lefthand', opening, {
    offsetMs: 0,
    references: [{ kind: 'action', source: 'pray', target: 'prayer' }],
  });
  const run = need(createRun(target));
  need(createPerson(run, admitted));
  const view = need(
    inspect(run, {
      perspective: { kind: 'host' },
      people: ['yusuf'],
      select: ['persona'],
      portable: { person: 'yusuf', castId: parent.castId, castRevision: parent.castRevision },
    }),
  );
  const part = view.people[0]?.parts.find((p) => p.select === 'persona');
  const result = part?.value as unknown as {
    retained: {
      agenda: { commitments: { actions: string[]; normId: string }[] };
      memory: { episodes: unknown[]; sourceTrust: Record<string, number> };
    };
  };
  expect(result.retained.agenda.commitments[0]).toMatchObject({ actions: ['prayer'], normId: 'salah' });
  expect(result.retained.memory.episodes.length).toBeGreaterThan(0);
  expect(result.retained.memory.sourceTrust.player).toBe(0.6);
});

it('replays checkpoint lineage and refuses a tampered or living terminal source', async () => {
  const parent = await source();
  const spec = exampleSpec();
  const run = need(createRun(spec));
  need(createPerson(run, authoredPerson('yusuf', 'Yusuf', 'male')));
  const native: NativeCastSource = {
    actorId: 'yusuf',
    archive: structuredClone(exportRun(run)) as NativeCastSource['archive'],
  };
  const receipt = await checkpointReceipt(native);
  expect(receipt.fullHash).toBe(native.archive.hashes.full);
  await expect(validateCheckpointLineage(native, native, parent.castId)).resolves.toBeUndefined();
  const tampered = structuredClone(native);
  tampered.archive.current.at += MINUTE;
  await expect(validateCheckpointLineage(tampered, native, parent.castId)).rejects.toThrow();
  await expect(
    validateTerminalSource(native, { ...parent, terminal: { kind: 'dead', at: receipt.at } }),
  ).rejects.toThrow('does not establish death');
});
