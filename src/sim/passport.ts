/** Supported portable identities retain their source and their receiving ownership claim.
 * The complete input and mapping are replay data. HF validates mapped references and
 * calendar meanings when the authored actor is installed in the Run.
 */
import {
  exportRun,
  inspect,
  type PersonAuthoring,
  type PortableAdmission,
  type RunArchive,
  replay,
  type SourcedNorm,
} from '@adam0white/human-framework';
import {
  admitPortablePerson,
  canonicalCast,
  canonicalPersona,
  claimPortablePerson,
  createPersona,
  type LifePreparation,
  lifeAdmission,
  type PersonaEnvelope,
  portablePersonOwner,
  portablePersonRole,
  preparePersonaLife,
  validatePortablePerson,
} from '@adam0white/lab-client';
import { ALLOCATION, localRole } from './cast.ts';
import { authoringOf, type Person, personRun, portableFromPerson } from './hf.ts';
import { SITE_CAST_NORMS } from './transport-norms.ts';

export const HOST_RULES = 'valley-cast-4';
export const VALLEY_DUES: SourcedNorm = {
  id: 'dues',
  label: 'The valley household’s agreed share',
  standing: 'obligatory',
  sources: [
    { kind: 'assumption', ref: 'Valley household share; each person understands the agreement locally' },
  ],
  provenance: { kind: 'authored-world', author: 'valley', ruleId: 'dues', edition: HOST_RULES },
  exemptions: [],
};
export const TRUSTED_NORMS = [...SITE_CAST_NORMS, VALLEY_DUES];

/** A retained source carries its own full calendar and reference IDs. Identity
 * mappings are checked against the receiving Run's definitions by createPerson.
 * Unknown IDs or mismatched norms refuse admission rather than being dropped.
 */
export function admitCast(
  opening: Person,
  input: LifePreparation,
): { person: PersonAuthoring; limitations: string[] } {
  const parent = input.parent;
  const role = portablePersonRole(parent, 'valley');
  if (role !== localRole(parent.castId) || opening.id !== role)
    throw new Error('Portable source does not match the Valley role.');
  if (canonicalPersona(preparePersonaLife(parent, input.clockMs).life) !== canonicalPersona(input.life))
    throw new Error('Pinned life differs from its source/clock.');
  const portable = validatePortablePerson(parent.transfer.portable);
  if (portable.version !== 2)
    throw new Error('This chapter requires retained portable history. Keep the source chapter or export it.');
  const authored = structuredClone(authoringOf(opening));
  // HF owns the source memory and commitments. Avoid competing authored history.
  authored.biography = [];
  authored.state.beliefs = [];
  authored.state.expectations = [];
  authored.state.sourceTrust = [];
  authored.state.heldNorms = [];
  authored.state.agenda.commitments = [];
  authored.state.agenda.owed = [];
  authored.state.agenda.goals = [];
  authored.state.agenda.precommitments = [];
  const mapping: PortableAdmission['mapping'] = {
    offsetMs: opening.now * 60000 - portable.retained.at,
    references: [],
  };
  const person = admitPortablePerson(parent, 'valley', authored, mapping);
  return { person, limitations: ['Source runtime and RNG remain in the source archive.'] };
}

export interface CastStart {
  version: typeof HOST_RULES;
  people: Record<string, PersonAuthoring>;
  inputs: LifePreparation[];
  claims: PersonaEnvelope[];
  limitations: Record<string, string[]>;
}
export function prepareCastStart(
  openings: Person[],
  inputs: LifePreparation[],
  claims: PersonaEnvelope[] = [],
): CastStart {
  if (inputs.length > 6 || new Set(inputs.map((i) => i.parent.castId)).size !== inputs.length)
    throw new Error('Invalid cast batch.');
  const people: Record<string, PersonAuthoring> = {};
  const limitations: Record<string, string[]> = {};
  for (const c of ALLOCATION) {
    const opening = openings.find((p) => p.id === localRole(c.castId));
    if (!opening) throw new Error('Missing opening actor.');
    const input = inputs.find((i) => i.parent.castId === c.castId);
    const result = input
      ? admitCast(opening, input)
      : { person: structuredClone(authoringOf(opening)), limitations: [] };
    people[c.castId] = result.person;
    limitations[c.castId] = result.limitations;
  }
  for (const input of inputs)
    if (!ALLOCATION.some((c) => c.castId === input.parent.castId)) throw new Error('Outside cast batch.');
  return {
    version: HOST_RULES,
    people,
    inputs: structuredClone(inputs),
    claims: structuredClone(claims),
    limitations,
  };
}
export function validateCastStart(openings: Person[], header: CastStart, preflight = false) {
  if (header.version !== HOST_RULES) throw new Error('Older cast chapter; start fresh.');
  if (!preflight && header.claims.length !== header.inputs.length)
    throw new Error('Missing complete cast claims.');
  for (const input of preflight ? [] : header.inputs) {
    const claim = header.claims.find((p) => p.castId === input.parent.castId);
    if (
      !claim ||
      claim.parentRevision !== input.parent.revision ||
      claim.branchId !== input.parent.branchId ||
      canonicalPersona(claim.source) !== canonicalPersona(input.parent.source) ||
      canonicalPersona(claim.transfer) !==
        canonicalPersona({ ...claimPortablePerson(input.parent, 'valley'), life: input.life })
    )
      throw new Error('Claim differs from its pinned parent and life.');
  }
  const expected = prepareCastStart(openings, header.inputs, header.claims);
  if (canonicalPersona(expected) !== canonicalPersona(header))
    throw new Error('Pinned cast admission differs from semantic preflight.');
  return expected;
}
export function lifeFacts(input: LifePreparation) {
  return lifeAdmission(input, 'valley');
}

/** A checkpoint is derived from the live Run's public portable inspection. HF
 * projects the actual actor and retains the initial portable history. The client
 * validates the resulting source role, cast identity, and prior ownership. The
 * full native archive is retained separately by the host as source evidence.
 */
export interface NativeCastSource {
  actorId: string;
  archive: RunArchive;
}

export async function checkpointTransfer(
  p: Person,
  castId: string,
  source: PersonaEnvelope['source'],
  previous?: PersonaEnvelope,
  hostObligations: string[] = [],
): Promise<{ transfer: Record<string, unknown>; source: NativeCastSource }> {
  if (source.game !== 'valley' || hostObligations.length)
    throw new Error('This person has unfinished host responsibilities or an incompatible source.');
  if (previous) {
    if (previous.castId !== castId) throw new Error('Portable identity differs from its prior chapter.');
    const owner = portablePersonOwner(previous);
    if (owner && owner !== 'valley') throw new Error('This person still belongs to another chapter.');
  }
  const run = personRun(p);
  if (!run) throw new Error('A current Run is required for a portable checkpoint.');
  const cast = canonicalCast(castId);
  const projected = portableFromPerson(p, castId, cast.revision).person;
  const portable = validatePortablePerson(projected);
  const native: NativeCastSource = { actorId: p.id, archive: structuredClone(exportRun(run)) as RunArchive };
  if (previous?.transfer.portableClaim) {
    const initial = native.archive.initial.people.find((actor) => actor.id === p.id)?.portable?.person;
    if (!initial || canonicalPersona(initial) !== canonicalPersona(previous.transfer.portable))
      throw new Error('The Run does not contain the claimed source history.');
  }
  const checkpoint = await checkpointReceipt(native);
  const transfer = { castPassport: 'hf-portable-person/2', portable, checkpoint };
  const candidate = await createPersona({
    format: 'hf-persona/1',
    castId,
    castRevision: cast.revision,
    branchId: previous?.branchId ?? 'valley-source-check',
    parentRevision: previous?.revision ?? null,
    source,
    transfer,
    limitations: [],
  });
  if (portablePersonRole(candidate, 'valley') !== p.id)
    throw new Error('Portable source role differs from this actor.');
  return { transfer, source: native };
}

/** Replay the full native source before using its checkpoint as evidence. */
export async function checkpointReceipt(source: NativeCastSource | Person) {
  const native: NativeCastSource =
    'archive' in source
      ? source
      : (() => {
          const run = personRun(source);
          if (!run) throw new Error('A current Run is required for a checkpoint.');
          return { actorId: source.id, archive: structuredClone(exportRun(run)) as RunArchive };
        })();
  const result = replay(native.archive);
  if (
    !result.ok ||
    !result.value.verified ||
    result.value.fullHash !== native.archive.hashes.full ||
    !native.archive.initial.people.some((p) => p.id === native.actorId)
  )
    throw new Error('Native source Run does not replay.');
  const sha256 = Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalPersona(native.archive))),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
  return { actorId: native.actorId, at: native.archive.current.at, fullHash: result.value.fullHash, sha256 };
}

export async function validateCheckpointSource(
  source: NativeCastSource,
  envelope: PersonaEnvelope,
): Promise<void> {
  const receipt = await checkpointReceipt(source);
  if (canonicalPersona(receipt) !== canonicalPersona(envelope.transfer.checkpoint))
    throw new Error('Checkpoint differs from its native source.');
  const replayed = replay(source.archive);
  if (!replayed.ok) throw new Error('Native source Run does not replay.');
  const result = inspect(replayed.value.run, {
    perspective: { kind: 'host' },
    people: [source.actorId],
    select: ['persona'],
    portable: { person: source.actorId, castId: envelope.castId, castRevision: envelope.castRevision },
  });
  if (!result.ok) throw new Error(result.error.message);
  const part = result.value.people[0]?.parts.find((p) => p.select === 'persona');
  if (
    !part ||
    canonicalPersona(validatePortablePerson(part.value)) !== canonicalPersona(envelope.transfer.portable) ||
    portablePersonRole(envelope, 'valley') !== source.actorId
  )
    throw new Error('Portable checkpoint differs from its native source.');
}

/** A terminal source is evidence only after full Run replay and public inspection. */
export async function validateTerminalSource(
  source: NativeCastSource,
  envelope: PersonaEnvelope,
): Promise<void> {
  const receipt = await checkpointReceipt(source);
  const checked = replay(source.archive);
  if (
    !checked.ok ||
    !envelope.terminal ||
    envelope.terminal.kind !== 'dead' ||
    envelope.terminal.at !== receipt.at ||
    source.actorId !== localRole(envelope.castId)
  )
    throw new Error('Terminal receipt differs from its native source.');
  const view = inspect(checked.value.run, {
    perspective: { kind: 'host' },
    people: [source.actorId],
    select: ['summary'],
  });
  if (!view.ok) throw new Error(view.error.message);
  const person = view.value.people[0];
  if (person?.kind !== 'host') throw new Error('Terminal source has no host view.');
  const summary = person.parts.find((part) => part.select === 'summary');
  if (summary?.select !== 'summary' || summary.value.alive)
    throw new Error('Terminal source does not establish death.');
}

/** Both snapshots must replay and share the complete initial Run, including its
 * pinned portable source. A later checkpoint cannot silently switch chapters. */
export async function validateCheckpointLineage(
  current: NativeCastSource,
  prior: NativeCastSource,
  castId: string,
): Promise<void> {
  await checkpointReceipt(current);
  await checkpointReceipt(prior);
  const role = localRole(castId);
  if (
    current.actorId !== role ||
    prior.actorId !== role ||
    current.archive.hashes.initial !== prior.archive.hashes.initial ||
    canonicalPersona(current.archive.initial) !== canonicalPersona(prior.archive.initial) ||
    current.archive.current.at < prior.archive.current.at ||
    prior.archive.history.length > current.archive.history.length ||
    canonicalPersona(current.archive.history.slice(0, prior.archive.history.length)) !==
      canonicalPersona(prior.archive.history)
  )
    throw new Error('Checkpoint is not a continuation of its native source Run.');
}
